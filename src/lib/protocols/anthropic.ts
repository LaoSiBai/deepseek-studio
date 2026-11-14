import type { ToolCall, Workspace } from '../../types';
import { isDeepSeekEndpoint } from '../deepseek';
import { applyDeepSeekExtensions, fileBlocksForAnthropic, isRecord, mapAnthropicUsage, safeJsonParse } from './shared';
import type {
  BuildOutput,
  ParsedChunk,
  ParsedResponse,
  ProtocolAdapter,
  StreamParser,
} from './types';

interface AnthropicBlock {
  type: string;
  id?: string;
  name?: string;
  args: string;
  toolIndex?: number;
}

function openAiToolsToAnthropic(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw)) return null;
  const tools: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const fn = isRecord(item.function) ? item.function : null;
    if (!fn) continue;
    tools.push({
      name: typeof fn.name === 'string' ? fn.name : '',
      ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
      input_schema: fn.parameters ?? { type: 'object', properties: {} },
    });
  }
  return tools;
}

function imageBlock(url: string): Record<string, unknown> {
  const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (dataUrl) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] },
    };
  }
  return { type: 'image', source: { type: 'url', url } };
}

function mapStopReason(reason: string): string {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'refusal') return 'content_filter';
  return reason;
}

function anthropicBody(workspace: Workspace): BuildOutput {
  const { endpoint, params, messages } = workspace;
  const errors: string[] = [];
  const warnings: string[] = [];
  const model = endpoint.model.trim();
  if (!model) errors.push('model 不能为空');
  if (messages.length === 0) errors.push('至少需要一条消息');

  const systemParts: string[] = [];
  const wire: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];

  const pushBlocks = (role: 'user' | 'assistant', blocks: Record<string, unknown>[]) => {
    if (blocks.length === 0) return;
    const last = wire[wire.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else wire.push({ role, content: blocks });
  };

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      pushBlocks('user', [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id ?? '',
          content: message.content,
        },
      ]);
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: Record<string, unknown>[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls ?? []) {
        const parsed = safeJsonParse(call.function.arguments);
        if (parsed === null && call.function.arguments.trim()) {
          warnings.push(`工具 ${call.function.name} 的 arguments 不是合法 JSON，已按空对象发送`);
        }
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: isRecord(parsed) ? parsed : {},
        });
      }
      pushBlocks('assistant', blocks);
      continue;
    }
    const blocks: Record<string, unknown>[] = [];
    if (message.content) blocks.push({ type: 'text', text: message.content });
    for (const image of message.images ?? []) {
      if (image.url) blocks.push(imageBlock(image.url));
    }
    blocks.push(...fileBlocksForAnthropic(message.files ?? []));
    pushBlocks('user', blocks);
  }

  const maxTokensRaw = params.max_completion_tokens || params.max_tokens;
  const maxTokens = maxTokensRaw ? Number(maxTokensRaw) : 4096;
  if (!Number.isFinite(maxTokens)) errors.push('max tokens 不是有效数字');

  const body: Record<string, unknown> = {
    model,
    max_tokens: Number.isFinite(maxTokens) ? maxTokens : 4096,
    messages: wire,
    stream: endpoint.stream,
  };
  if (systemParts.length > 0) body.system = systemParts.join('\n\n');

  if (params.temperature) {
    const value = Number(params.temperature);
    if (Number.isFinite(value)) body.temperature = value;
  }
  if (params.top_p) {
    const value = Number(params.top_p);
    if (Number.isFinite(value)) body.top_p = value;
  }
  if (params.thinking) body.thinking = { type: params.thinking };
  if (params.stop) {
    body.stop_sequences = params.stop
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (params.tools) {
    const parsed = safeJsonParse(params.tools);
    const tools = openAiToolsToAnthropic(parsed);
    if (!tools) errors.push('tools 必须是 OpenAI function 数组');
    else if (tools.length > 0) body.tools = tools;
  }
  if (params.tool_choice) {
    if (params.tool_choice === 'custom') {
      const parsed = safeJsonParse(params.tool_choice_json ?? '');
      if (!isRecord(parsed)) errors.push('tool_choice JSON 无效');
      else body.tool_choice = parsed;
    } else if (params.tool_choice === 'required') {
      body.tool_choice = { type: 'any' };
    } else {
      body.tool_choice = { type: params.tool_choice };
    }
  }

  if (params.response_format) {
    warnings.push('Anthropic Messages 不支持 response_format，已忽略（可用 extraBody）');
  }
  if (params.frequency_penalty || params.presence_penalty) {
    warnings.push('Anthropic Messages 不支持 frequency/presence penalty，已忽略');
  }
  if (params.reasoning_effort) {
    warnings.push('Anthropic Messages 使用 thinking.type，reasoning_effort 已忽略');
  }

  if (isDeepSeekEndpoint(workspace.endpoint.baseUrl)) {
    applyDeepSeekExtensions(body, params, warnings);
  }

  return { body, errors, warnings };
}

function readAnthropic(json: unknown): ParsedResponse | null {
  if (!isRecord(json)) return null;
  const blocks = Array.isArray(json.content) ? json.content : [];
  let content = '';
  let reasoning = '';
  const toolCalls: ToolCall[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') content += block.text;
    if (block.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking;
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: typeof block.id === 'string' ? block.id : '',
        type: 'function',
        function: {
          name: typeof block.name === 'string' ? block.name : '',
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  const stopReason = typeof json.stop_reason === 'string' ? json.stop_reason : null;
  return {
    content,
    reasoning,
    toolCalls,
    usage: mapAnthropicUsage(json.usage),
    finishReason: stopReason ? mapStopReason(stopReason) : null,
  };
}

class AnthropicStreamParser implements StreamParser {
  private toolCalls: ToolCall[] = [];
  private usageRaw: Record<string, unknown> = {};
  private finishReason: string | null = null;
  private blocks = new Map<number, AnthropicBlock>();

  push(json: unknown): ParsedChunk {
    if (!isRecord(json)) return {};
    const type = typeof json.type === 'string' ? json.type : '';

    if (type === 'error') {
      const error = isRecord(json.error) ? json.error : null;
      return {
        error:
          error && typeof error.message === 'string'
            ? error.message
            : 'Anthropic API 返回错误',
      };
    }

    if (type === 'message_start') {
      const message = isRecord(json.message) ? json.message : null;
      if (message && isRecord(message.usage)) this.usageRaw = { ...message.usage };
      return this.usageChunk();
    }

    if (type === 'content_block_start') {
      const index = typeof json.index === 'number' ? json.index : 0;
      const block = isRecord(json.content_block) ? json.content_block : {};
      const info: AnthropicBlock = {
        type: typeof block.type === 'string' ? block.type : 'text',
        args: '',
      };
      if (block.type === 'tool_use') {
        info.id = typeof block.id === 'string' ? block.id : '';
        info.name = typeof block.name === 'string' ? block.name : '';
        this.toolCalls.push({
          id: info.id,
          type: 'function',
          function: { name: info.name, arguments: '' },
        });
        info.toolIndex = this.toolCalls.length - 1;
      }
      this.blocks.set(index, info);
      return this.toolChunk();
    }

    if (type === 'content_block_delta') {
      const index = typeof json.index === 'number' ? json.index : 0;
      const delta = isRecord(json.delta) ? json.delta : {};
      const block = this.blocks.get(index);
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return { contentDelta: delta.text };
      }
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return { reasoningDelta: delta.thinking };
      }
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && block) {
        block.args += delta.partial_json;
        if (block.toolIndex !== undefined) {
          const call = this.toolCalls[block.toolIndex];
          if (call) call.function.arguments = block.args;
        }
        return this.toolChunk();
      }
      return {};
    }

    if (type === 'content_block_stop') {
      const index = typeof json.index === 'number' ? json.index : 0;
      const block = this.blocks.get(index);
      if (block && block.type === 'tool_use' && block.toolIndex !== undefined) {
        const call = this.toolCalls[block.toolIndex];
        if (call && block.args) call.function.arguments = block.args;
        return this.toolChunk();
      }
      return {};
    }

    if (type === 'message_delta') {
      if (isRecord(json.usage)) this.usageRaw = { ...this.usageRaw, ...json.usage };
      const delta = isRecord(json.delta) ? json.delta : {};
      if (typeof delta.stop_reason === 'string') {
        this.finishReason = mapStopReason(delta.stop_reason);
      }
      return {
        ...(this.usageChunk().usage ? { usage: this.usageChunk().usage } : {}),
        ...(this.finishReason ? { finishReason: this.finishReason } : {}),
      };
    }

    if (type === 'message_stop') {
      return this.finishReason ? { finishReason: this.finishReason } : {};
    }

    return {};
  }

  finish(): ParsedChunk {
    return this.finishReason ? { finishReason: this.finishReason } : {};
  }

  private usageChunk(): ParsedChunk {
    const usage = mapAnthropicUsage(this.usageRaw);
    return usage ? { usage } : {};
  }

  private toolChunk(): ParsedChunk {
    return this.toolCalls.length > 0 ? { toolCalls: [...this.toolCalls] } : {};
  }
}

export const anthropicMessagesProtocol: ProtocolAdapter = {
  id: 'anthropic-messages',
  label: 'Anthropic Messages',
  defaultPath: '/v1/messages',
  capabilities: {
    temperature: { min: 0, max: 1 },
    supportsMaxTokens: true,
    supportsJsonSchema: false,
    supportsTools: true,
    supportsImages: true,
    supportsFiles: true,
    supportsServerTools: false,
    supportsSafety: false,
    supportsTitle: false,
    supportsUsageDetails: true,
    toolChoiceValues: ['auto', 'none', 'required', 'custom'],
  },
  buildBody: anthropicBody,
  readResponse: readAnthropic,
  createStreamParser: () => new AnthropicStreamParser(),
  readBusinessError: (json) => {
    if (!isRecord(json)) return null;
    if (json.type === 'error') {
      const error = isRecord(json.error) ? json.error : null;
      if (error && typeof error.message === 'string') return error.message;
      return 'Anthropic API 返回错误';
    }
    return null;
  },
};
