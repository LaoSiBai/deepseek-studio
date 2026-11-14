import type { Endpoint, StreamFrame, ToolCall, Usage } from '../types';
import { joinUrl } from './utils';
import { getProtocol } from './protocols';
import type { ParsedChunk } from './protocols/types';

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

function buildRequestHeaders(endpoint: Endpoint): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: endpoint.stream ? 'text/event-stream' : 'application/json',
  };
  const key = endpoint.apiKey.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  if (endpoint.protocol === 'anthropic-messages' && endpoint.baseUrl.includes('api.deepseek.com')) {
    headers['anthropic-beta'] = 'files-api-2025-04-14';
  }
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

  const adapter = getProtocol(endpoint.protocol);
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

  // 请求的是流式但服务端回的是 JSON（例如 MiniMax 的业务错误），按普通 JSON 解析
  const contentType = (responseHeaders['content-type'] ?? '').toLowerCase();
  if (!endpoint.stream || !contentType.includes('text/event-stream')) {
    const text = await response.text();
    onEvent({ type: 'raw', text });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, `响应不是合法 JSON：\n${text.slice(0, 2000)}`);
    }
    const businessError = adapter.readBusinessError(json);
    // 抛原始 JSON，错误面板才能解析出 base_resp.status_code 等元信息
    if (businessError) throw new ApiError(response.status, text);
    const parsed = adapter.readResponse(json);
    const durationMs = performance.now() - started;
    if (parsed?.content) onEvent({ type: 'delta', content: parsed.content });
    if (parsed?.reasoning) onEvent({ type: 'delta', reasoning: parsed.reasoning });
    if (parsed?.toolCalls.length) onEvent({ type: 'delta', toolCalls: parsed.toolCalls });
    if (parsed?.usage) onEvent({ type: 'usage', usage: parsed.usage });
    onEvent({ type: 'finish', finishReason: parsed?.finishReason ?? null });
    return {
      httpStatus: response.status,
      content: parsed?.content ?? '',
      reasoning: parsed?.reasoning ?? '',
      toolCalls: parsed?.toolCalls ?? [],
      usage: parsed?.usage ?? null,
      finishReason: parsed?.finishReason ?? null,
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
  let currentEvent: string | undefined;
  const parser = adapter.createStreamParser();

  const emitDeltaIfAny = (content?: string, reasoning?: string) => {
    if (!content && !reasoning) return;
    if (acc.ttftMs === null && (content || reasoning)) acc.ttftMs = performance.now() - started;
    onEvent({ type: 'delta', content, reasoning });
  };

  const applyChunk = (chunk: ParsedChunk, at: number, payload: string) => {
    if (chunk.error) {
      onEvent({ type: 'frame', kind: 'error', text: chunk.error, at });
      throw new ApiError(response.status, chunk.error);
    }
    let content = chunk.contentDelta ?? '';
    // 部分协议（MiniMax）末帧才给完整正文：仅在累计为空时兜底，避免重复
    if (!acc.content && !content && chunk.finalContent) content = chunk.finalContent;
    const reasoning = chunk.reasoningDelta ?? '';

    if (chunk.usage) {
      acc.usage = chunk.usage;
      onEvent({ type: 'usage', usage: chunk.usage });
    }
    if (chunk.toolCalls) {
      acc.toolCalls = chunk.toolCalls;
      onEvent({ type: 'delta', toolCalls: acc.toolCalls });
    }
    if (chunk.finishReason) {
      acc.finishReason = chunk.finishReason;
      onEvent({ type: 'finish', finishReason: chunk.finishReason });
    }

    if (content) acc.content += content;
    if (reasoning) acc.reasoning += reasoning;
    emitDeltaIfAny(content, reasoning);

    const summary = [
      content && `content +${content.length}`,
      reasoning && `reasoning +${reasoning.length}`,
      chunk.toolCalls && `tools ${chunk.toolCalls.length}`,
    ]
      .filter(Boolean)
      .join(' · ');
    onEvent({
      type: 'frame',
      kind: content || reasoning ? 'delta' : 'info',
      text: summary || (payload.length > 400 ? `${payload.slice(0, 400)}…` : payload),
      at,
    });
  };

  const handlePayload = (payload: string, eventName: string | undefined, at: number) => {
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
    applyChunk(parser.push(json, eventName), at, payload);
  };

  const handleLine = (line: string, at: number) => {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      handlePayload(line.slice(5).trim(), currentEvent, at);
      currentEvent = undefined;
      return;
    }
    if (line && !line.startsWith(':')) {
      onEvent({ type: 'frame', kind: 'raw', text: line, at });
    }
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
        handleLine(line, performance.now() - started);
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) {
      handleLine(buffer.replace(/\r$/, ''), performance.now() - started);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 流已被取消或仍占用时忽略 */
    }
  }

  const tail = parser.finish();
  if (tail.usage) acc.usage = tail.usage;
  if (tail.finishReason) acc.finishReason = tail.finishReason;

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
