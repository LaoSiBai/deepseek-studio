import type { ToolCall, Usage, Workspace } from '../../types';
import { isRecord, mergeToolCallDeltas, toText } from './shared';
import { buildOpenAICompatibleBody } from './openai';
import type {
  BuildOutput,
  ParsedChunk,
  ParsedResponse,
  ProtocolAdapter,
  StreamParser,
} from './types';

function minimaxBody(workspace: Workspace): BuildOutput {
  const output = buildOpenAICompatibleBody(workspace);
  const { body, warnings } = output;

  // max_tokens 在 MiniMax 已弃用，补一份 max_completion_tokens
  if (typeof body.max_tokens === 'number' && body.max_completion_tokens === undefined) {
    body.max_completion_tokens = body.max_tokens;
    warnings.push('MiniMax 已弃用 max_tokens，已同时写入 max_completion_tokens');
  }
  if (typeof body.max_tokens === 'number' && typeof body.max_completion_tokens === 'number') {
    delete body.max_tokens;
  }

  if (typeof body.tool_choice === 'string' && !['auto', 'none'].includes(body.tool_choice)) {
    warnings.push(`MiniMax 的 tool_choice 只支持 auto / none，已移除 ${body.tool_choice}`);
    delete body.tool_choice;
  }

  if (typeof body.temperature === 'number' && body.temperature > 1) {
    warnings.push('MiniMax 的 temperature 范围是 (0, 1]，当前值可能被拒绝');
  }

  if (body.thinking !== undefined) {
    warnings.push('MiniMax 原生接口不使用 thinking 字段，已移除；可用 extraBody 手动传');
    delete body.thinking;
  }

  return { body, errors: output.errors, warnings };
}

function readMiniMaxResponse(json: unknown): ParsedResponse | null {
  if (!isRecord(json)) return null;
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  return {
    content: toText(message?.content) || toText(choice?.text),
    reasoning: toText(message?.reasoning_content ?? message?.reasoning),
    toolCalls: Array.isArray(message?.tool_calls) ? (message.tool_calls as ToolCall[]) : [],
    usage: isRecord(json.usage) ? (json.usage as Usage) : null,
    finishReason:
      choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

function minimaxBusinessError(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const base = isRecord(json.base_resp) ? json.base_resp : null;
  if (base && typeof base.status_code === 'number' && base.status_code !== 0) {
    return typeof base.status_msg === 'string' && base.status_msg
      ? base.status_msg
      : `MiniMax error ${base.status_code}`;
  }
  return null;
}

class MiniMaxStreamParser implements StreamParser {
  private toolCalls: ToolCall[] = [];
  private usage: Usage | null = null;
  private finishReason: string | null = null;

  push(json: unknown): ParsedChunk {
    if (!isRecord(json)) return {};
    const businessError = minimaxBusinessError(json);
    if (businessError) return { error: businessError };

    if (isRecord(json.usage)) this.usage = json.usage as Usage;

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    if (!choice) {
      return this.usage ? { usage: this.usage } : {};
    }

    let contentDelta = '';
    let reasoningDelta = '';
    let finalContent: string | undefined;

    if (isRecord(choice.delta)) {
      contentDelta = toText(choice.delta.content);
      reasoningDelta = toText(choice.delta.reasoning_content ?? choice.delta.reasoning);
      if (Array.isArray(choice.delta.tool_calls)) {
        mergeToolCallDeltas(this.toolCalls, choice.delta.tool_calls);
      }
    } else if (isRecord(choice.message)) {
      // MiniMax 流式最后一帧带完整 message；只作为兜底，避免正文重复
      finalContent = toText(choice.message.content) || undefined;
      if (Array.isArray(choice.message.tool_calls)) {
        this.toolCalls = choice.message.tool_calls as ToolCall[];
      }
    }

    if (typeof choice.finish_reason === 'string') this.finishReason = choice.finish_reason;

    const chunk: ParsedChunk = {};
    if (contentDelta) chunk.contentDelta = contentDelta;
    if (reasoningDelta) chunk.reasoningDelta = reasoningDelta;
    if (finalContent) chunk.finalContent = finalContent;
    if (this.toolCalls.length > 0) chunk.toolCalls = [...this.toolCalls];
    if (this.usage) chunk.usage = this.usage;
    if (this.finishReason) chunk.finishReason = this.finishReason;
    return chunk;
  }

  finish(): ParsedChunk {
    return {};
  }
}

export const miniMaxChatProtocol: ProtocolAdapter = {
  id: 'minimax-chat',
  label: 'MiniMax Chat (native)',
  defaultPath: '/v1/text/chatcompletion_v2',
  capabilities: {
    temperature: { min: 0, max: 1, hint: 'MiniMax temperature 范围 (0, 1]' },
    supportsMaxTokens: false,
    supportsJsonSchema: true,
    supportsTools: true,
    supportsImages: true,
    supportsFiles: false,
    supportsServerTools: false,
    supportsSafety: false,
    supportsTitle: false,
    supportsUsageDetails: true,
    toolChoiceValues: ['auto', 'none'],
  },
  buildBody: minimaxBody,
  readResponse: readMiniMaxResponse,
  createStreamParser: () => new MiniMaxStreamParser(),
  readBusinessError: minimaxBusinessError,
};
