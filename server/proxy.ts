import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

interface ProxyPayload {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface StudioProxyOptions {
  apiKey?: string;
  defaultBaseUrl?: string;
  /** 转发时使用的 HTTP(S) 代理，例如 http://127.0.0.1:7890 */
  proxyUrl?: string;
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return '请求已取消';
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}

async function handleProxy(
  req: IncomingMessage,
  res: ServerResponse,
  envKey: string | undefined,
  proxyAgent: ProxyAgent | null,
) {
  let payload: ProxyPayload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw.toString('utf8')) as ProxyPayload;
  } catch (err) {
    sendJson(res, 400, { error: `请求体解析失败: ${errorMessage(err)}` });
    return;
  }

  let target: URL;
  try {
    target = new URL(String(payload.url ?? ''));
  } catch {
    sendJson(res, 400, { error: '无效的目标 URL' });
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    sendJson(res, 400, { error: '只允许 http/https' });
    return;
  }

  const method = (payload.method ?? 'POST').toUpperCase();
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.headers ?? {})) {
    if (!key || HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (typeof value !== 'string') continue;
    headers[key] = value;
  }
  // 避免上游压缩干扰流式透传
  headers['accept-encoding'] = 'identity';

  const hasAuth = Object.keys(headers).some((key) => {
    const k = key.toLowerCase();
    return k === 'authorization' || k === 'x-api-key' || k === 'api-key';
  });
  if (!hasAuth && envKey) headers.authorization = `Bearer ${envKey}`;

  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);

  const host = target.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const bypass =
    !proxyAgent ||
    isLocal ||
    noProxy.some((entry) => entry === '*' || host === entry || host.endsWith(`.${entry}`));

  try {
    const upstream = await undiciFetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload.body,
      signal: controller.signal,
      redirect: 'manual',
      dispatcher: bypass ? undefined : proxyAgent,
    });

    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (HOP_BY_HOP.has(k)) return;
      if (k === 'content-encoding' || k === 'content-length') return;
      try {
        res.setHeader(key, value);
      } catch {
        /* 非法头直接跳过 */
      }
    });
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();

    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 502, { error: errorMessage(err) });
    } else {
      res.end();
    }
  } finally {
    res.off('close', onClose);
  }
}

export function studioProxy(options: StudioProxyOptions): Plugin {
  const envKey = options.apiKey?.trim() || undefined;
  const proxyUrl = options.proxyUrl?.trim() || undefined;
  const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;

  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(async (req, res, next) => {
      const rawUrl = req.url ?? '/';
      if (!rawUrl.startsWith('/api/')) {
        next();
        return;
      }
      const pathname = rawUrl.split('?')[0];

      try {
        if (pathname === '/api/env' && req.method === 'GET') {
          sendJson(res, 200, {
            hasServerKey: Boolean(envKey),
            defaultBaseUrl: options.defaultBaseUrl || 'https://api.deepseek.com',
          });
          return;
        }
        if (pathname === '/api/proxy') {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: '只支持 POST' });
            return;
          }
          await handleProxy(req, res, envKey, proxyAgent);
          return;
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        sendJson(res, 500, { error: errorMessage(err) });
      }
    });
  };

  return {
    name: 'deepseek-studio-proxy',
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
