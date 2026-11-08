export type Role = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface HeaderRow {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ImageAttachment {
  id: string;
  name: string;
  /** data: URL 或 http(s) URL；持久化时 data URL 会被清空，避免撑爆 localStorage */
  url: string;
  detail?: 'low' | 'high' | 'original' | 'auto';
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** DeepSeek reasoner 多轮历史里的思考内容，可手改 */
  reasoning_content?: string;
  /** Chat Prefix Completion (Beta)：最后一条 assistant 消息带 prefix: true */
  prefix?: boolean;
  /** 图片输入（仅 user 消息有效）；走 content 数组的 image_url 块 */
  images?: ImageAttachment[];
  /** 以完整 JSON 对象编辑/发送该条消息（支持 content 数组、多模态等） */
  raw?: boolean;
  rawJson?: string;
  collapsed?: boolean;
}

export interface Endpoint {
  baseUrl: string;
  path: string;
  method: 'POST' | 'GET';
  model: string;
  /** 空字符串表示使用服务端 .env 中的 key */
  apiKey: string;
  stream: boolean;
  headers: HeaderRow[];
}

/** 参数值统一以字符串保存，构建请求时按字段类型转换；undefined / '' 表示不发送 */
export type ParamValues = Record<string, string | undefined>;

export interface Workspace {
  endpoint: Endpoint;
  params: ParamValues;
  extraBody: string;
  messages: Message[];
  rawMode: boolean;
  rawBody: string;
}

export interface Preset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  endpoint: Endpoint;
  params: ParamValues;
  extraBody: string;
  messages: Message[];
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; audio_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number; audio_tokens?: number };
  [key: string]: unknown;
}

export interface StreamFrame {
  index: number;
  /** 相对请求开始的时间，ms */
  t: number;
  kind: 'delta' | 'usage' | 'done' | 'error' | 'info' | 'raw';
  text: string;
}

export type RunPhase = 'idle' | 'running' | 'done' | 'error' | 'aborted';

export interface RunState {
  id: string;
  phase: RunPhase;
  startedAt: number;
  httpStatus: number | null;
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  finishReason: string | null;
  error: string | null;
  ttftMs: number | null;
  durationMs: number;
  frames: StreamFrame[];
  rawResponse: string;
  responseHeaders: Record<string, string>;
  requestUrl: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  stream: boolean;
  contentTruncated: boolean;
}

export interface RunRecord {
  id: string;
  at: number;
  label: string;
  endpoint: Endpoint;
  params: ParamValues;
  extraBody: string;
  messages: Message[];
  status: number | null;
  durationMs: number;
  ttftMs: number | null;
  usage: Usage | null;
  finishReason: string | null;
  content: string;
  reasoning: string;
  error: string | null;
  requestBody: string;
  stream: boolean;
}
