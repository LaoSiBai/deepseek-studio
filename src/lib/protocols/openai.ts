import type { ToolCall, Usage, Workspace } from '../../types';
import { PARAM_DEFS, messageToWire } from '../params';
import { parseJson, setPath } from '../utils';
import { isRecord, mergeToolCallDeltas, toText } from './shared';
import type {
  BuildOutput,
  ParsedChunk,
  ParsedResponse,
  ProtocolAdapter,
  StreamParser,
} from './types';

/** OpenAI Chat Completions 兼容格式的请求体（DeepSeek / OpenAI / 中转 / MiniMax 兼容端点共用） */
export function buildOpenAICompatibleBody(workspace: Workspace): BuildOutput {
  const { endpoint, params, messages } = workspace;
  const errors: string[] = [];
  const warnings: string[] = [];
  const model = endpoint.model.trim();
  if (!model) errors.push('model 不能为空');
  if (messages.length === 0) errors.push('至少需要一条消息');

  const body: Record<string, unknown> = {
    model,
    messages: messages.map(messageToWire),
    stream: endpoint.stream,
  };

  for (const def of PARAM_DEFS) {
    if (def.skipBuild) continue;
    const raw = params[def.key];
    if (raw === undefined || raw === '') continue;
    const path = def.path ?? [def.key];

    if (def.key === 'response_format') {
      if (raw === 'json_object') {
        body.response_format = { type: 'json_object' };
      } else if (raw === 'json_schema') {
        const parsed = parseJson(params.json_schema ?? '');
        if (!parsed.ok) {
          errors.push(`json_schema 不是合法 JSON：${parsed.error}`);
        } else {
          body.response_format = { type: 'json_schema', json_schema: parsed.value };
        }
      } else {
        body.response_format = { type: raw };
      }
      continue;
    }

    if (def.key === 'tool_choice') {
      if (raw === 'custom') {
        const parsed = parseJson(params.tool_choice_json ?? '');
        if (!parsed.ok) errors.push(`tool_choice JSON 无效：${parsed.error}`);
        else body.tool_choice = parsed.value;
      } else {
        body.tool_choice = raw;
      }
      continue;
    }

    if (def.key === 'thinking') {
      body.thinking = { type: raw };
      continue;
    }

    switch (def.kind) {
      case 'number': {
        const num = Number(raw);
        if (!Number.isFinite(num)) errors.push(`${def.label} 不是有效数字`);
        else setPath(body, path, num);
        break;
      }
      case 'boolean':
        setPath(body, path, raw === 'true');
        break;
      case 'text':
        setPath(body, path, raw);
        break;
      case 'tags':
        setPath(
          body,
          path,
          raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        );
        break;
      case 'json': {
        const parsed = parseJson(raw);
        if (!parsed.ok) errors.push(`${def.label} 不是合法 JSON：${parsed.error}`);
        else setPath(body, path, parsed.value);
        break;
      }
      case 'select':
        setPath(body, path, raw);
        break;
    }
  }

  return { body, errors, warnings };
}

function readOpenAIResponse(json: unknown): ParsedResponse | null {
  if (!isRecord(json)) return null;
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const content = toText(message?.content) || toText(choice?.text);
  const reasoning = toText(message?.reasoning_content ?? message?.reasoning);
  const toolCalls = Array.isArray(message?.tool_calls) ? (message.tool_calls as ToolCall[]) : [];
  return {
    content,
    reasoning,
    toolCalls,
    usage: isRecord(json.usage) ? (json.usage as Usage) : null,
    finishReason:
      choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

class OpenAIStreamParser implements StreamParser {
  private toolCalls: ToolCall[] = [];
  private usage: Usage | null = null;
  private finishReason: string | null = null;

  push(json: unknown): ParsedChunk {
    if (!isRecord(json)) return {};
    const error = isRecord(json.error) ? json.error : null;
    if (error && typeof error.message === 'string') return { error: error.message };

    if (isRecord(json.usage)) this.usage = json.usage as Usage;

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    if (!choice) {
      return this.usage ? { usage: this.usage } : {};
    }

    const delta = isRecord(choice.delta)
      ? choice.delta
      : isRecord(choice.message)
        ? choice.message
        : {};
    const content = toText(delta.content) || toText(choice.text);
    const reasoning = toText(delta.reasoning_content ?? delta.reasoning);
    if (Array.isArray(delta.tool_calls)) {
      mergeToolCallDeltas(this.toolCalls, delta.tool_calls);
    }
    if (typeof choice.finish_reason === 'string') this.finishReason = choice.finish_reason;

    const chunk: ParsedChunk = {};
    if (content) chunk.contentDelta = content;
    if (reasoning) chunk.reasoningDelta = reasoning;
    if (this.toolCalls.length > 0) chunk.toolCalls = [...this.toolCalls];
    if (this.usage) chunk.usage = this.usage;
    if (this.finishReason) chunk.finishReason = this.finishReason;
    return chunk;
  }

  finish(): ParsedChunk {
    return {};
  }
}

export const openAIChatProtocol: ProtocolAdapter = {
  id: 'openai-chat',
  label: 'OpenAI Chat Compatible',
  defaultPath: '/chat/completions',
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
  buildBody: buildOpenAICompatibleBody,
  readResponse: readOpenAIResponse,
  createStreamParser: () => new OpenAIStreamParser(),
  readBusinessError: (json) => {
    if (!isRecord(json)) return null;
    const error = isRecord(json.error) ? json.error : null;
    if (error && typeof error.message === 'string') return error.message;
    return null;
  },
};
