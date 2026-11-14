import type { FileRef, ParamValues, ToolCall, Usage } from '../../types';

/** Chat Completions / Responses 的文件引用块 */
export function fileBlocksForChat(files: FileRef[]): Record<string, unknown>[] {
  return files.map((file) => ({ type: 'file', file_id: file.fileId }));
}

/** Anthropic Messages 的文档块 */
export function fileBlocksForAnthropic(files: FileRef[]): Record<string, unknown>[] {
  return files.map((file) => ({
    type: 'document',
    source: { type: 'file', file_id: file.fileId },
  }));
}

const SERVER_TOOLS = new Set(['deepseek_web_search', 'deepseek_read_url']);

/** DeepSeek 应用层扩展：服务端工具、内容安全、会话标题（三个协议格式一致） */
export function applyDeepSeekExtensions(
  body: Record<string, unknown>,
  params: ParamValues,
  warnings: string[],
): void {
  if (params.server_tools) {
    const names = params.server_tools
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const tools = Array.isArray(body.tools) ? (body.tools as unknown[]) : [];
    for (const name of names) {
      if (!SERVER_TOOLS.has(name)) {
        warnings.push(`未知服务端工具 ${name}，已忽略`);
        continue;
      }
      const exists = tools.some((tool) => isRecord(tool) && tool.name === name && tool.type === name);
      if (!exists) tools.push({ type: name, name });
    }
    if (tools.length > 0) body.tools = tools;
  }
  if (params.safety_level) body.safety_check = { level: params.safety_level };
  if (params.title_enabled === 'true') body.title = { enabled: true };
}

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
