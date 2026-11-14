import type { ToolCall, Usage, Workspace } from '../../types';
import { isDeepSeekEndpoint } from '../deepseek';
import { applyDeepSeekExtensions, fileBlocksForChat, isRecord, mapResponsesUsage, safeJsonParse } from './shared';
import type {
  BuildOutput,
  ParsedChunk,
  ParsedResponse,
  ProtocolAdapter,
  StreamParser,
} from './types';

interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: unknown;
}

function openAiToolsToResponses(raw: unknown): ResponsesTool[] | null {
  if (!Array.isArray(raw)) return null;
  const tools: ResponsesTool[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const fn = isRecord(item.function) ? item.function : null;
    if (!fn) continue;
    tools.push({
      type: 'function',
      name: typeof fn.name === 'string' ? fn.name : '',
      ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
      ...(fn.parameters !== undefined ? { parameters: fn.parameters } : {}),
    });
  }
  return tools;
}

function responsesBody(workspace: Workspace): BuildOutput {
  const { endpoint, params, messages } = workspace;
  const errors: string[] = [];
  const warnings: string[] = [];
  const model = endpoint.model.trim();
  if (!model) errors.push('model 不能为空');
  if (messages.length === 0) errors.push('至少需要一条消息');

  const instructions: string[] = [];
  const input: Record<string, unknown>[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      if (message.content.trim()) instructions.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id ?? '',
        output: message.content,
      });
      continue;
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      if (message.content) input.push({ role: 'assistant', content: message.content });
      continue;
    }
    const images = message.role === 'user' ? (message.images ?? []).filter((i) => i.url) : [];
    const files = message.role === 'user' ? (message.files ?? []) : [];
    if (images.length > 0 || files.length > 0) {
      const parts: Record<string, unknown>[] = [];
      if (message.content) parts.push({ type: 'input_text', text: message.content });
      for (const image of images) {
        parts.push({ type: 'input_image', image_url: image.url });
      }
      parts.push(...fileBlocksForChat(files));
      input.push({ role: 'user', content: parts });
    } else {
      input.push({ role: message.role, content: message.content });
    }
  }

  const body: Record<string, unknown> = {
    model,
    input,
    stream: endpoint.stream,
  };
  if (instructions.length > 0) body.instructions = instructions.join('\n\n');

  const temperature = params.temperature ? Number(params.temperature) : null;
  if (temperature !== null && Number.isFinite(temperature)) body.temperature = temperature;
  const topP = params.top_p ? Number(params.top_p) : null;
  if (topP !== null && Number.isFinite(topP)) body.top_p = topP;

  const maxTokens = params.max_completion_tokens || params.max_tokens;
  if (maxTokens) {
    const value = Number(maxTokens);
    if (Number.isFinite(value)) body.max_output_tokens = value;
    else errors.push('max tokens 不是有效数字');
  }

  if (params.reasoning_effort) {
    body.reasoning = { effort: params.reasoning_effort };
  } else if (params.thinking === 'disabled') {
    body.reasoning = { effort: 'none' };
  }

  if (params.tools) {
    const parsed = safeJsonParse(params.tools);
    const tools = openAiToolsToResponses(parsed);
    if (!tools) errors.push('tools 必须是 OpenAI function 数组');
    else if (tools.length > 0) body.tools = tools;
  }

  if (params.tool_choice) {
    if (params.tool_choice === 'custom') {
      const parsed = safeJsonParse(params.tool_choice_json ?? '');
      if (parsed === null) errors.push('tool_choice JSON 无效');
      else body.tool_choice = parsed;
    } else {
      body.tool_choice = params.tool_choice;
    }
  }

  if (params.response_format === 'json_object') {
    body.text = { format: { type: 'json_object' } };
  } else if (params.response_format === 'json_schema') {
    const parsed = safeJsonParse(params.json_schema ?? '');
    if (!isRecord(parsed)) {
      errors.push('json_schema 必须包含 name 和 schema');
    } else {
      body.text = {
        format: {
          type: 'json_schema',
          name: typeof parsed.name === 'string' ? parsed.name : 'response',
          schema: parsed.schema ?? {},
          ...(parsed.strict === true ? { strict: true } : {}),
        },
      };
    }
  }

  if (params.stop) warnings.push('Responses API 不支持 stop，已忽略（可写进 extraBody）');
  if (params.frequency_penalty || params.presence_penalty) {
    warnings.push('Responses API 不支持 frequency/presence penalty，已忽略');
  }
  if (params.logprobs === 'true') warnings.push('Responses API 不支持 logprobs，已忽略');

  if (isDeepSeekEndpoint(workspace.endpoint.baseUrl)) {
    applyDeepSeekExtensions(body, params, warnings);
  }

  return { body, errors, warnings };
}

function readResponses(json: unknown): ParsedResponse | null {
  if (!isRecord(json)) return null;
  const output = Array.isArray(json.output) ? json.output : [];
  let content = '';
  let reasoning = '';
  const toolCalls: ToolCall[] = [];

  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content : [];
      for (const part of parts) {
        if (isRecord(part) && typeof part.text === 'string') content += part.text;
      }
    } else if (item.type === 'reasoning') {
      const parts = Array.isArray(item.summary) ? item.summary : [];
      for (const part of parts) {
        if (isRecord(part) && typeof part.text === 'string') reasoning += part.text;
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: typeof item.call_id === 'string' ? item.call_id : String(item.id ?? ''),
        type: 'function',
        function: {
          name: typeof item.name === 'string' ? item.name : '',
          arguments: typeof item.arguments === 'string' ? item.arguments : '',
        },
      });
    }
  }

  if (!content && typeof json.output_text === 'string') content = json.output_text;

  let finishReason: string | null = null;
  if (json.status === 'incomplete') {
    const details = isRecord(json.incomplete_details) ? json.incomplete_details : null;
    finishReason =
      details && typeof details.reason === 'string' ? details.reason : 'incomplete';
  } else if (json.status === 'completed') {
    finishReason = 'stop';
  }

  return {
    content,
    reasoning,
    toolCalls,
    usage: mapResponsesUsage(json.usage),
    finishReason,
  };
}

class ResponsesStreamParser implements StreamParser {
  private toolCalls: ToolCall[] = [];
  private usage: Usage | null = null;
  private finishReason: string | null = null;
  private pending = new Map<string, { index: number; arguments: string }>();

  push(json: unknown): ParsedChunk {
    if (!isRecord(json)) return {};
    const type = typeof json.type === 'string' ? json.type : '';

    if (type === 'response.failed') {
      const response = isRecord(json.response) ? json.response : null;
      const error = response && isRecord(response.error) ? response.error : null;
      return {
        error:
          error && typeof error.message === 'string'
            ? error.message
            : 'Responses API 返回 response.failed',
      };
    }

    if (type === 'response.output_text.delta' && typeof json.delta === 'string') {
      return { contentDelta: json.delta };
    }
    if (type === 'response.reasoning_text.delta' && typeof json.delta === 'string') {
      return { reasoningDelta: json.delta };
    }

    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = isRecord(json.item) ? json.item : null;
      if (!item || item.type !== 'function_call') return {};
      const callId = typeof item.call_id === 'string' ? item.call_id : String(item.id ?? '');
      const index = this.toolCalls.findIndex((call) => call.id === callId);
      const target =
        index >= 0
          ? this.toolCalls[index]
          : {
              id: callId,
              type: 'function' as const,
              function: { name: '', arguments: '' },
            };
      if (typeof item.name === 'string') target.function.name = item.name;
      if (typeof item.arguments === 'string' && item.arguments) {
        target.function.arguments = item.arguments;
      }
      if (index < 0) {
        this.toolCalls.push(target);
        this.pending.set(callId, { index: this.toolCalls.length - 1, arguments: '' });
      }
      return { toolCalls: [...this.toolCalls] };
    }

    if (type === 'response.function_call_arguments.delta') {
      const callId = typeof json.item_id === 'string' ? json.item_id : '';
      const pending = this.pending.get(callId);
      if (!pending || typeof json.delta !== 'string') return {};
      pending.arguments += json.delta;
      const target = this.toolCalls[pending.index];
      if (target) target.function.arguments = pending.arguments;
      return { toolCalls: [...this.toolCalls] };
    }

    if (type === 'response.completed' || type === 'response.incomplete') {
      const response = isRecord(json.response) ? json.response : null;
      if (response) {
        const mapped = mapResponsesUsage(response.usage);
        if (mapped) this.usage = mapped;
      }
      this.finishReason = type === 'response.completed' ? 'stop' : 'incomplete';
      return {
        ...(this.usage ? { usage: this.usage } : {}),
        finishReason: this.finishReason,
      };
    }

    return {};
  }

  finish(): ParsedChunk {
    return {};
  }
}

export const deepSeekResponsesProtocol: ProtocolAdapter = {
  id: 'deepseek-responses',
  label: 'OpenAI Responses',
  defaultPath: '/responses',
  capabilities: {
    temperature: { min: 0, max: 2 },
    supportsMaxTokens: true,
    supportsJsonSchema: true,
    supportsTools: true,
    supportsImages: true,
    supportsFiles: false,
    supportsServerTools: false,
    supportsSafety: false,
    supportsTitle: false,
    supportsUsageDetails: true,
    toolChoiceValues: ['auto', 'none', 'required', 'custom'],
  },
  buildBody: responsesBody,
  readResponse: readResponses,
  createStreamParser: () => new ResponsesStreamParser(),
  readBusinessError: (json) => {
    if (!isRecord(json)) return null;
    const error = isRecord(json.error) ? json.error : null;
    if (error && typeof error.message === 'string') return error.message;
    if (json.status === 'failed') return 'Responses API 请求失败';
    return null;
  },
};
