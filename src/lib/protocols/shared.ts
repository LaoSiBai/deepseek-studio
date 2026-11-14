import type { ToolCall, Usage } from '../../types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isRecord(part)) {
          if (typeof part.text === 'string') return part.text;
          return JSON.stringify(part);
        }
        return String(part);
      })
      .join('');
  }
  return JSON.stringify(value);
}

/** OpenAI 流式 tool_calls 增量合并 */
export function mergeToolCallDeltas(acc: ToolCall[], deltas: unknown): void {
  if (!Array.isArray(deltas)) return;
  for (const raw of deltas) {
    if (!isRecord(raw)) continue;
    const index = typeof raw.index === 'number' ? raw.index : acc.length;
    while (acc.length <= index) {
      acc.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
    }
    const target = acc[index];
    if (typeof raw.id === 'string') target.id = raw.id;
    const fn = isRecord(raw.function) ? raw.function : null;
    if (fn && typeof fn.name === 'string') target.function.name = fn.name;
    if (fn && typeof fn.arguments === 'string') target.function.arguments += fn.arguments;
  }
}

/** Responses API usage → 统一 Usage */
export function mapResponsesUsage(raw: unknown): Usage | null {
  if (!isRecord(raw)) return null;
  const input = typeof raw.input_tokens === 'number' ? raw.input_tokens : undefined;
  const output = typeof raw.output_tokens === 'number' ? raw.output_tokens : undefined;
  const total = typeof raw.total_tokens === 'number' ? raw.total_tokens : undefined;
  const inputDetails = isRecord(raw.input_tokens_details) ? raw.input_tokens_details : null;
  const outputDetails = isRecord(raw.output_tokens_details) ? raw.output_tokens_details : null;
  const usage: Usage = {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: total,
  };
  if (inputDetails && typeof inputDetails.cached_tokens === 'number') {
    usage.prompt_tokens_details = { cached_tokens: inputDetails.cached_tokens };
  }
  if (outputDetails && typeof outputDetails.reasoning_tokens === 'number') {
    usage.completion_tokens_details = { reasoning_tokens: outputDetails.reasoning_tokens };
  }
  if (isRecord(raw.server_tool_use)) {
    usage.server_tool_use = raw.server_tool_use;
  }
  return usage;
}

/** Anthropic usage → 统一 Usage（缓存命中计入 prompt） */
export function mapAnthropicUsage(raw: unknown): Usage | null {
  if (!isRecord(raw)) return null;
  const input = typeof raw.input_tokens === 'number' ? raw.input_tokens : 0;
  const cacheRead = typeof raw.cache_read_input_tokens === 'number' ? raw.cache_read_input_tokens : 0;
  const cacheWrite =
    typeof raw.cache_creation_input_tokens === 'number' ? raw.cache_creation_input_tokens : 0;
  const output = typeof raw.output_tokens === 'number' ? raw.output_tokens : 0;
  const usage: Usage = {
    prompt_tokens: input + cacheRead + cacheWrite,
    completion_tokens: output,
    total_tokens: input + cacheRead + cacheWrite + output,
  };
  if (cacheRead > 0 || cacheWrite > 0) {
    usage.prompt_tokens_details = { cached_tokens: cacheRead };
  }
  if (isRecord(raw.server_tool_use)) {
    usage.server_tool_use = raw.server_tool_use;
  }
  return usage;
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
