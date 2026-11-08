import type { Endpoint, StreamFrame, ToolCall, Usage } from '../types';
import { joinUrl } from './utils';

export class ApiError extends Error {
  status: number | null;
  body: string;

  constructor(status: number | null, body: string) {
    super(body || `HTTP ${status ?? '网络错误'}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export type RunEvent =
  | { type: 'request'; url: string; headers: Record<string, string>; body: string }
  | { type: 'status'; status: number; headers: Record<string, string> }
  | { type: 'first-byte'; at: number }
  | { type: 'frame'; kind: StreamFrame['kind']; text: string; at: number }
  | { type: 'delta'; content?: string; reasoning?: string; toolCalls?: ToolCall[] }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; finishReason: string | null }
  | { type: 'raw'; text: string };

export interface RunOutcome {
  httpStatus: number | null;
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  finishReason: string | null;
  rawResponse: string;
  ttftMs: number | null;
  durationMs: number;
  responseHeaders: Record<string, string>;
}

interface RunInput {
  endpoint: Endpoint;
  body: string;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
}

interface StreamAccumulator {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  finishReason: string | null;
  raw: string;
  ttftMs: number | null;
}

export type Transport = 'proxy' | 'direct';

let transportPromise: Promise<Transport> | null = null;

/**
 * 探测本地代理：dev / preview 下有 /api/env，走代理；
 * 纯静态部署（GitHub Pages 等）没有该接口，改为浏览器直连上游。
 */
export function detectTransport(): Promise<Transport> {
  if (!transportPromise) {
    transportPromise = fetch('/api/env', { method: 'GET', cache: 'no-store' })
      .then((response) => {
        const contentType = response.headers.get('content-type') ?? '';
        return response.ok && contentType.includes('application/json')
          ? ('proxy' as const)
          : ('direct' as const);
      })
      .catch(() => 'direct' as const);
  }
  return transportPromise;
}

function mergeToolCallDeltas(acc: ToolCall[], deltas: unknown): void {
  if (!Array.isArray(deltas)) return;
  for (const raw of deltas) {
    if (typeof raw !== 'object' || raw === null) continue;
    const delta = raw as {
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    };
    const index = typeof delta.index === 'number' ? delta.index : acc.length;
    while (acc.length <= index) {
      acc.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
    }
    const target = acc[index];
    if (delta.id) target.id = delta.id;
    if (delta.function?.name) target.function.name = delta.function.name;
    if (delta.function?.arguments) target.function.arguments += delta.function.arguments;
  }
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null) {
          const p = part as { text?: unknown; type?: unknown };
          if (typeof p.text === 'string') return p.text;
          return JSON.stringify(part);
        }
        return String(part);
      })
      .join('');
  }
  return JSON.stringify(value);
}

function buildRequestHeaders(endpoint: Endpoint): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: endpoint.stream ? 'text/event-stream' : 'application/json',
  };
  const key = endpoint.apiKey.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  for (const row of endpoint.headers) {
    if (!row.enabled || !row.name.trim()) continue;
    headers[row.name.trim()] = row.value;
  }
  return headers;
}

export async function runChatRequest(input: RunInput): Promise<RunOutcome> {
  const { endpoint, body, signal, onEvent } = input;
  const url = joinUrl(endpoint.baseUrl, endpoint.path);
  const headers = buildRequestHeaders(endpoint);
  onEvent({ type: 'request', url, headers, body });

  const started = performance.now();
  const transport = await detectTransport();
  let response: Response;
  try {
    if (transport === 'proxy') {
      response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, method: endpoint.method, headers, body }),
        signal,
      });
    } else {
      response = await fetch(url, { method: endpoint.method, headers, body, signal });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      null,
      transport === 'proxy'
        ? `连接本地代理失败：${message}`
        : `直连接口失败：${message}。若控制台显示 CORS 错误，说明该端点不允许浏览器跨域；本地 pnpm dev 会走代理。`,
    );
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  onEvent({ type: 'status', status: response.status, headers: responseHeaders });

  if (!response.ok) {
    const text = await response.text();
    onEvent({ type: 'raw', text });
    throw new ApiError(response.status, text);
  }

  if (!endpoint.stream) {
    const text = await response.text();
    onEvent({ type: 'raw', text });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, `响应不是合法 JSON：\n${text.slice(0, 2000)}`);
    }
    const payload = json as {
      choices?: {
        message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: ToolCall[] };
        /** FIM / completions 接口用 text 返回 */
        text?: unknown;
        finish_reason?: string | null;
      }[];
      usage?: Usage;
      error?: { message?: string };
    };
    if (payload.error?.message) throw new ApiError(response.status, payload.error.message);
    const choice = payload.choices?.[0];
    const content = toText(choice?.message?.content) || toText(choice?.text);
    const reasoning = toText(choice?.message?.reasoning_content ?? choice?.message?.reasoning);
    const durationMs = performance.now() - started;
    if (content) onEvent({ type: 'delta', content });
    if (reasoning) onEvent({ type: 'delta', reasoning });
    if (payload.usage) onEvent({ type: 'usage', usage: payload.usage });
    onEvent({ type: 'finish', finishReason: choice?.finish_reason ?? null });
    return {
      httpStatus: response.status,
      content,
      reasoning,
      toolCalls: choice?.message?.tool_calls ?? [],
      usage: payload.usage ?? null,
      finishReason: choice?.finish_reason ?? null,
      rawResponse: text,
      ttftMs: durationMs,
      durationMs,
      responseHeaders,
    };
  }

  if (!response.body) throw new ApiError(response.status, '响应没有 body');

  const acc: StreamAccumulator = {
    content: '',
    reasoning: '',
    toolCalls: [],
    usage: null,
    finishReason: null,
    raw: '',
    ttftMs: null,
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstByte = true;

  const emitDeltaIfAny = (content?: string, reasoning?: string) => {
    if (!content && !reasoning) return;
    if (acc.ttftMs === null && (content || reasoning)) acc.ttftMs = performance.now() - started;
    onEvent({ type: 'delta', content, reasoning });
  };

  const handlePayload = (payload: string, at: number) => {
    if (!payload) return;
    if (payload.trim() === '[DONE]') {
      onEvent({ type: 'frame', kind: 'done', text: '[DONE]', at });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      onEvent({ type: 'frame', kind: 'raw', text: payload, at });
      return;
    }
    const chunk = json as {
      choices?: {
        delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: unknown };
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
          tool_calls?: unknown;
        };
        /** FIM / completions 流式 chunk：text 直接在 choice 上 */
        text?: unknown;
        finish_reason?: string | null;
      }[];
      usage?: Usage;
      error?: { message?: string; type?: string };
    };
    if (chunk.error?.message) {
      onEvent({ type: 'frame', kind: 'error', text: chunk.error.message, at });
      throw new ApiError(response.status, chunk.error.message);
    }
    if (chunk.usage) {
      acc.usage = chunk.usage;
      onEvent({ type: 'usage', usage: chunk.usage });
    }
    const choice = chunk.choices?.[0];
    if (!choice) {
      onEvent({ type: 'frame', kind: 'info', text: payload.length > 600 ? `${payload.slice(0, 600)}…` : payload, at });
      return;
    }
    const delta = choice.delta ?? choice.message ?? {};
    const content = toText(delta.content) || toText(choice.text);
    const reasoning = toText(delta.reasoning_content ?? delta.reasoning);
    if (content) acc.content += content;
    if (reasoning) acc.reasoning += reasoning;
    if (delta.tool_calls) {
      mergeToolCallDeltas(acc.toolCalls, delta.tool_calls);
      onEvent({ type: 'delta', toolCalls: acc.toolCalls });
    }
    if (choice.finish_reason) {
      acc.finishReason = choice.finish_reason;
      onEvent({ type: 'finish', finishReason: choice.finish_reason });
    }
    emitDeltaIfAny(content, reasoning);
    const summary = [content && `content +${content.length}`, reasoning && `reasoning +${reasoning.length}`]
      .filter(Boolean)
      .join(' · ');
    onEvent({
      type: 'frame',
      kind: content || reasoning ? 'delta' : 'info',
      text: summary || (payload.length > 400 ? `${payload.slice(0, 400)}…` : payload),
      at,
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByte) {
        firstByte = false;
        onEvent({ type: 'first-byte', at: performance.now() - started });
      }
      const text = decoder.decode(value, { stream: true });
      acc.raw += text;
      buffer += text;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          handlePayload(line.slice(5).trim(), performance.now() - started);
        } else if (line && !line.startsWith(':')) {
          onEvent({ type: 'frame', kind: 'raw', text: line, at: performance.now() - started });
        }
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) {
      const line = buffer.replace(/\r$/, '');
      if (line.startsWith('data:')) handlePayload(line.slice(5).trim(), performance.now() - started);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 流已被取消或仍占用时忽略 */
    }
  }

  const durationMs = performance.now() - started;
  if (acc.usage) onEvent({ type: 'usage', usage: acc.usage });
  if (acc.finishReason) onEvent({ type: 'finish', finishReason: acc.finishReason });

  return {
    httpStatus: response.status,
    content: acc.content,
    reasoning: acc.reasoning,
    toolCalls: acc.toolCalls,
    usage: acc.usage,
    finishReason: acc.finishReason,
    rawResponse: acc.raw,
    ttftMs: acc.content || acc.reasoning ? acc.ttftMs : null,
    durationMs,
    responseHeaders,
  };
}
