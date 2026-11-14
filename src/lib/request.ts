import type { Workspace } from '../types';
import { deepseekIssues, isDeepSeekEndpoint } from './deepseek';
import { getProtocol } from './protocols';
import { isPlainObject, parseJson } from './utils';

export interface BuildResult {
  body: string;
  parsed: Record<string, unknown> | null;
  error: string | null;
  warnings: string[];
}

function deepMergeInto(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMergeInto(current, value) : value;
  }
  return out;
}

/** 按当前协议生成请求体；raw 模式完全尊重手写 JSON */
export function buildRequestBody(workspace: Workspace): BuildResult {
  const { endpoint, params, messages, extraBody, rawMode, rawBody } = workspace;
  const warnings: string[] = [];

  if (rawMode) {
    const parsed = parseJson<Record<string, unknown>>(rawBody);
    if (!parsed.ok) {
      return { body: rawBody, parsed: null, error: `Raw body 不是合法 JSON：${parsed.error}`, warnings };
    }
    if (!isPlainObject(parsed.value)) {
      return { body: rawBody, parsed: null, error: 'Raw body 必须是 JSON 对象', warnings };
    }
    return { body: rawBody, parsed: parsed.value, error: null, warnings };
  }

  const errors: string[] = [];
  messages.forEach((message, index) => {
    if (!message.raw || !message.rawJson) return;
    const parsed = parseJson(message.rawJson);
    if (!parsed.ok) errors.push(`第 ${index + 1} 条消息的 JSON 无效：${parsed.error}`);
    else if (!isPlainObject(parsed.value)) errors.push(`第 ${index + 1} 条消息必须是 JSON 对象`);
  });
  messages.forEach((message, index) => {
    if (message.images?.length && message.role !== 'user') {
      warnings.push(`第 ${index + 1} 条消息不是 user，图片会被忽略（多数端点只接受 user 消息里的图片）`);
    }
  });

  const adapter = getProtocol(endpoint.protocol);
  const output = adapter.buildBody(workspace);
  const body = output.body;
  errors.push(...output.errors);
  warnings.push(...output.warnings);

  // 常用组合的提醒
  if (params.max_tokens && params.max_completion_tokens) {
    warnings.push('max_tokens 与 max_completion_tokens 同时设置，部分端点会拒绝');
  }
  if (params.temperature && params.top_p) {
    warnings.push('同时改了 temperature 与 top_p，通常建议只调一个');
  }
  if (params.tool_choice && !params.tools) {
    warnings.push('设置了 tool_choice 但没有 tools');
  }
  if (params.top_logprobs && params.logprobs !== 'true') {
    warnings.push('top_logprobs 需要 logprobs = true');
  }
  if (params.stream_include_usage === 'true' && !endpoint.stream) {
    warnings.push('非流式请求下 stream_options 无意义');
  }
  for (const issue of deepseekIssues(endpoint, params, messages)) {
    warnings.push(issue.message);
  }
  if (!isDeepSeekEndpoint(endpoint.baseUrl)) {
    const nValue = Number(params.n ?? '');
    if (Number.isFinite(nValue) && nValue > 1 && endpoint.stream) {
      warnings.push('stream 开启时 n > 1 多数端点只会返回第一条候选；要看全部候选请关闭 stream');
    }
  }

  if (extraBody.trim()) {
    const parsed = parseJson<unknown>(extraBody);
    if (!parsed.ok) {
      errors.push(`额外参数 JSON 无效：${parsed.error}`);
    } else if (!isPlainObject(parsed.value)) {
      errors.push('额外参数必须是 JSON 对象');
    } else {
      Object.assign(body, deepMergeInto(body, parsed.value));
    }
  }

  return {
    body: JSON.stringify(body, null, 2),
    parsed: body,
    error: errors.length ? [...new Set(errors)].join('\n') : null,
    warnings: [...new Set(warnings)],
  };
}
