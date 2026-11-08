import type { Endpoint, Message, ParamValues, Workspace } from '../types';
import { isPlainObject, parseJson, setPath } from './utils';
import { deepseekIssues, isDeepSeekEndpoint } from './deepseek';

export type ParamGroupId = 'sampling' | 'penalty' | 'length' | 'format' | 'tools' | 'advanced';

export const PARAM_GROUPS: { id: ParamGroupId; label: string; note: string }[] = [
  { id: 'sampling', label: '采样', note: 'temperature / top_p / top_k' },
  { id: 'penalty', label: '惩罚', note: 'frequency / presence / repetition' },
  { id: 'length', label: '长度与停止', note: 'max_tokens / stop / seed' },
  { id: 'format', label: '输出格式', note: 'response_format / logprobs / usage' },
  { id: 'tools', label: '工具调用', note: 'tools / tool_choice' },
  { id: 'advanced', label: '高级与供应商参数', note: 'reasoning / thinking / metadata' },
];

export interface ParamDef {
  key: string;
  label: string;
  group: ParamGroupId;
  kind: 'number' | 'boolean' | 'select' | 'text' | 'tags' | 'json';
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** 写入 body 的路径，默认 [key] */
  path?: string[];
  /** 依赖另一个参数值才显示 */
  dependsOn?: { key: string; value: string };
  /** 由别的字段负责写入 body（仅 UI 展示） */
  skipBuild?: boolean;
  full?: boolean;
}

const select = (
  key: string,
  label: string,
  group: ParamGroupId,
  options: string[],
  hint?: string,
): ParamDef => ({
  key,
  label,
  group,
  kind: 'select',
  hint,
  options: [
    { value: '', label: '不发送' },
    ...options.map((value) => ({ value, label: value })),
  ],
});

export const PARAM_DEFS: ParamDef[] = [
  {
    key: 'temperature',
    label: 'temperature',
    group: 'sampling',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.05,
    placeholder: '默认 1',
    hint: '越高越发散；通常与 top_p 只调一个',
  },
  {
    key: 'top_p',
    label: 'top_p',
    group: 'sampling',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: '默认 1',
    hint: '核采样阈值，1 表示不过滤',
  },
  {
    key: 'top_k',
    label: 'top_k',
    group: 'sampling',
    kind: 'number',
    min: 1,
    max: 1000,
    step: 1,
    placeholder: '仅部分端点',
    hint: '非 OpenAI 标准参数，DeepSeek / vLLM 等端点可能支持',
  },
  {
    key: 'n',
    label: 'n',
    group: 'sampling',
    kind: 'number',
    min: 1,
    max: 128,
    step: 1,
    placeholder: '默认 1',
    hint: '生成候选数量；DeepSeek 官方仅支持 1，其它值会返回 400',
  },
  {
    key: 'frequency_penalty',
    label: 'frequency_penalty',
    group: 'penalty',
    kind: 'number',
    min: -2,
    max: 2,
    step: 0.05,
    placeholder: '默认 0',
    hint: '按出现频次降低重复',
  },
  {
    key: 'presence_penalty',
    label: 'presence_penalty',
    group: 'penalty',
    kind: 'number',
    min: -2,
    max: 2,
    step: 0.05,
    placeholder: '默认 0',
    hint: '按是否出现过来鼓励新话题',
  },
  {
    key: 'repetition_penalty',
    label: 'repetition_penalty',
    group: 'penalty',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.01,
    placeholder: '第三方端点',
    hint: '常见于开源推理框架，OpenAI / DeepSeek 官方不接受',
  },
  {
    key: 'max_tokens',
    label: 'max_tokens',
    group: 'length',
    kind: 'number',
    min: 1,
    step: 1,
    placeholder: '默认端点上限',
    hint: '输出上限；与 max_completion_tokens 二选一',
  },
  {
    key: 'max_completion_tokens',
    label: 'max_completion_tokens',
    group: 'length',
    kind: 'number',
    min: 1,
    step: 1,
    placeholder: 'OpenAI 新模型',
    hint: 'o 系列 / 新模型推荐，包含推理 token',
  },
  {
    key: 'stop',
    label: 'stop',
    group: 'length',
    kind: 'tags',
    placeholder: '每行一个停止序列',
    hint: '命中后立即停止生成，最多通常 4 个',
    full: true,
  },
  {
    key: 'seed',
    label: 'seed',
    group: 'length',
    kind: 'number',
    min: 0,
    step: 1,
    placeholder: '不发送',
    hint: '尽力而为的确定性采样',
  },
  select('response_format', 'response_format', 'format', ['text', 'json_object', 'json_schema']),
  {
    key: 'json_schema',
    label: 'json_schema',
    group: 'format',
    kind: 'json',
    placeholder: '{"name":"result","schema":{...}}',
    hint: 'response_format = json_schema 时生效',
    dependsOn: { key: 'response_format', value: 'json_schema' },
    skipBuild: true,
    full: true,
  },
  {
    key: 'stream_include_usage',
    label: 'stream_options.include_usage',
    group: 'format',
    kind: 'boolean',
    path: ['stream_options', 'include_usage'],
    hint: '流式最后一帧附带 token 用量',
  },
  {
    key: 'logprobs',
    label: 'logprobs',
    group: 'format',
    kind: 'boolean',
    hint: '返回每个 token 的对数概率',
  },
  {
    key: 'top_logprobs',
    label: 'top_logprobs',
    group: 'format',
    kind: 'number',
    min: 0,
    max: 20,
    step: 1,
    placeholder: '0–20',
    hint: '需同时开启 logprobs',
  },
  {
    key: 'tools',
    label: 'tools',
    group: 'tools',
    kind: 'json',
    placeholder: '[{"type":"function","function":{"name":"get_weather","parameters":{...}}}]',
    hint: 'function calling 定义，JSON 数组',
    full: true,
  },
  {
    key: 'tool_choice',
    label: 'tool_choice',
    group: 'tools',
    kind: 'select',
    options: [
      { value: '', label: '不发送' },
      { value: 'auto', label: 'auto' },
      { value: 'none', label: 'none' },
      { value: 'required', label: 'required' },
      { value: 'custom', label: '自定义 JSON' },
    ],
  },
  {
    key: 'tool_choice_json',
    label: 'tool_choice（自定义）',
    group: 'tools',
    kind: 'json',
    placeholder: '{"type":"function","function":{"name":"get_weather"}}',
    dependsOn: { key: 'tool_choice', value: 'custom' },
    skipBuild: true,
    full: true,
  },
  {
    key: 'parallel_tool_calls',
    label: 'parallel_tool_calls',
    group: 'tools',
    kind: 'boolean',
    hint: '允许一次返回多个 tool call',
  },
  select(
    'reasoning_effort',
    'reasoning_effort',
    'advanced',
    ['none', 'minimal', 'low', 'medium', 'high', 'max'],
    '推理强度；DeepSeek 用 none / low / high / max',
  ),
  {
    key: 'thinking',
    label: 'thinking',
    group: 'advanced',
    kind: 'select',
    options: [
      { value: '', label: '不发送' },
      { value: 'enabled', label: 'enabled' },
      { value: 'disabled', label: 'disabled' },
    ],
    hint: 'DeepSeek 思考模式，写作 thinking: { type }',
  },
  {
    key: 'user',
    label: 'user',
    group: 'advanced',
    kind: 'text',
    placeholder: '终端用户标识',
    hint: '用于滥用追踪与缓存分桶',
  },
  select('service_tier', 'service_tier', 'advanced', ['auto', 'default', 'flex', 'priority']),
  {
    key: 'metadata',
    label: 'metadata',
    group: 'advanced',
    kind: 'json',
    placeholder: '{"trace_id":"..."}',
  },
];

export const PARAM_BY_KEY: Map<string, ParamDef> = new Map(PARAM_DEFS.map((def) => [def.key, def]));

/** 判断某个参数当前是否应在 UI 中显示 */
export function paramVisible(def: ParamDef, params: ParamValues): boolean {
  if (!def.dependsOn) return true;
  return (params[def.dependsOn.key] ?? '') === def.dependsOn.value;
}

export function messageToWire(message: Message): Record<string, unknown> {
  if (message.raw && message.rawJson) {
    const parsed = parseJson<Record<string, unknown>>(message.rawJson);
    if (parsed.ok && isPlainObject(parsed.value)) return parsed.value;
  }
  const out: Record<string, unknown> = { role: message.role };
  const images = message.role === 'user' ? (message.images ?? []).filter((image) => image.url) : [];
  if (images.length > 0) {
    const parts: unknown[] = [];
    if (message.content) parts.push({ type: 'text', text: message.content });
    for (const image of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: image.url, ...(image.detail ? { detail: image.detail } : {}) },
      });
    }
    out.content = parts;
  } else if (message.role === 'assistant' && message.tool_calls?.length && message.content === '') {
    out.content = null;
  } else {
    out.content = message.content;
  }
  if (message.name) out.name = message.name;
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  if (message.tool_calls?.length) out.tool_calls = message.tool_calls;
  if (message.reasoning_content) out.reasoning_content = message.reasoning_content;
  if (message.prefix) out.prefix = true;
  return out;
}

export interface BuildResult {
  body: string;
  parsed: Record<string, unknown> | null;
  error: string | null;
  warnings: string[];
}

export function buildRequestBody(workspace: Workspace): BuildResult {
  const { endpoint, params, messages, extraBody, rawMode, rawBody } = workspace;
  const warnings: string[] = [];

  if (rawMode) {
    const parsed = parseJson<Record<string, unknown>>(rawBody);
    if (!parsed.ok) return { body: rawBody, parsed: null, error: `Raw body 不是合法 JSON：${parsed.error}`, warnings };
    if (!isPlainObject(parsed.value)) return { body: rawBody, parsed: null, error: 'Raw body 必须是 JSON 对象', warnings };
    return { body: rawBody, parsed: parsed.value, error: null, warnings };
  }

  const errors: string[] = [];
  const model = endpoint.model.trim();
  if (!model) errors.push('model 不能为空');
  if (messages.length === 0) errors.push('至少需要一条消息');
  messages.forEach((message, index) => {
    if (!message.raw || !message.rawJson) return;
    const parsed = parseJson(message.rawJson);
    if (!parsed.ok) errors.push(`第 ${index + 1} 条消息的 JSON 无效：${parsed.error}`);
    else if (!isPlainObject(parsed.value)) errors.push(`第 ${index + 1} 条消息必须是 JSON 对象`);
  });
  messages.forEach((message, index) => {
    if (message.images?.length && message.role !== 'user') {
      warnings.push(`第 ${index + 1} 条消息不是 user，图片会被忽略（DeepSeek 只接受 user 消息里的图片）`);
    }
  });

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
        const schemaText = params.json_schema ?? '';
        const parsed = parseJson(schemaText);
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
        if (!Number.isFinite(num)) {
          errors.push(`${def.label} 不是有效数字`);
          break;
        }
        setPath(body, path, num);
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
    error: errors.length ? errors.join('\n') : null,
    warnings,
  };
}

function deepMergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMergeInto(current, value) : value;
  }
  return out;
}

export interface ImportResult {
  endpoint: Endpoint;
  params: ParamValues;
  extraBody: string;
  messages: Message[];
  unknownKeys: string[];
  error: string | null;
}

/** 把一份手写的 raw body 反向拆回表单（未知字段进 extraBody） */
export function importRawBody(raw: string, base: Workspace): ImportResult {
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed.ok) {
    return {
      endpoint: base.endpoint,
      params: base.params,
      extraBody: base.extraBody,
      messages: base.messages,
      unknownKeys: [],
      error: `JSON 无效：${parsed.error}`,
    };
  }
  if (!isPlainObject(parsed.value)) {
    return {
      endpoint: base.endpoint,
      params: base.params,
      extraBody: base.extraBody,
      messages: base.messages,
      unknownKeys: [],
      error: '请求体必须是 JSON 对象',
    };
  }

  const body = parsed.value;
  const endpoint: Endpoint = { ...base.endpoint };
  const params: ParamValues = {};
  const leftover: Record<string, unknown> = {};
  const unknownKeys: string[] = [];

  if (typeof body.model === 'string') endpoint.model = body.model;
  if (typeof body.stream === 'boolean') endpoint.stream = body.stream;

  let messages = base.messages;
  if (Array.isArray(body.messages)) {
    messages = body.messages.map((item, index) => rawToMessage(item, index));
  }

  for (const [key, value] of Object.entries(body)) {
    if (key === 'model' || key === 'messages' || key === 'stream') continue;

    if (key === 'response_format' && isPlainObject(value)) {
      const type = typeof value.type === 'string' ? value.type : '';
      params.response_format = type;
      if (type === 'json_schema' && value.json_schema !== undefined) {
        params.json_schema = JSON.stringify(value.json_schema, null, 2);
      }
      continue;
    }
    if (key === 'tool_choice') {
      if (typeof value === 'string') params.tool_choice = value;
      else {
        params.tool_choice = 'custom';
        params.tool_choice_json = JSON.stringify(value, null, 2);
      }
      continue;
    }
    if (key === 'thinking' && isPlainObject(value) && typeof value.type === 'string') {
      params.thinking = value.type;
      continue;
    }
    if (key === 'stream_options' && isPlainObject(value)) {
      if (typeof value.include_usage === 'boolean') params.stream_include_usage = String(value.include_usage);
      const rest = { ...value };
      delete rest.include_usage;
      if (Object.keys(rest).length) leftover.stream_options = rest;
      continue;
    }

    const def = PARAM_BY_KEY.get(key);
    if (def && def.kind === 'tags' && Array.isArray(value)) {
      params[key] = value.map((item) => String(item)).join('\n');
      continue;
    }
    if (def && !def.skipBuild && !def.path && def.kind !== 'json') {
      params[key] = toParamString(value);
      continue;
    }
    if (def && def.key === 'tools' && Array.isArray(value)) {
      params.tools = JSON.stringify(value, null, 2);
      continue;
    }
    if (def && def.key === 'metadata' && isPlainObject(value)) {
      params.metadata = JSON.stringify(value, null, 2);
      continue;
    }

    leftover[key] = value;
    unknownKeys.push(key);
  }

  return {
    endpoint,
    params,
    extraBody: Object.keys(leftover).length ? JSON.stringify(leftover, null, 2) : '',
    messages,
    unknownKeys,
    error: null,
  };
}

function toParamString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function rawToMessage(item: unknown, index: number): Message {
  const id = `import-${index}-${Math.random().toString(36).slice(2, 8)}`;
  if (!isPlainObject(item)) {
    return { id, role: 'user', content: String(item ?? '') };
  }
  const role = typeof item.role === 'string' ? item.role : 'user';
  const known = ['role', 'content'];
  const extra = Object.keys(item).filter((key) => !known.includes(key));
  const simpleContent = typeof item.content === 'string' || item.content === null;
  if (simpleContent && extra.every((key) => ['name', 'tool_call_id', 'tool_calls', 'reasoning_content'].includes(key))) {
    return {
      id,
      role: role as Message['role'],
      content: typeof item.content === 'string' ? item.content : '',
      name: typeof item.name === 'string' ? item.name : undefined,
      tool_call_id: typeof item.tool_call_id === 'string' ? item.tool_call_id : undefined,
      tool_calls: Array.isArray(item.tool_calls) ? (item.tool_calls as Message['tool_calls']) : undefined,
      reasoning_content: typeof item.reasoning_content === 'string' ? item.reasoning_content : undefined,
    };
  }
  return {
    id,
    role: role as Message['role'],
    content: typeof item.content === 'string' ? item.content : '',
    raw: true,
    rawJson: JSON.stringify(item, null, 2),
  };
}
