export interface ErrorSummary {
  headline: string;
  meta: string[];
  requestId: string | null;
  raw: string;
}

/**
 * 把 API 返回的错误整理成「一句主文案 + 元信息 + 原始响应」。
 * 主要针对 DeepSeek 的 { error: { message, type, code, param } } 结构，
 * 非 JSON 或其它结构则退回第一行原文。
 */
export function summarizeError(raw: string | null): ErrorSummary | null {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();

  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* 不是 JSON，按纯文本处理 */
  }

  if (payload && typeof payload === 'object') {
    const object = payload as {
      error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown };
      message?: unknown;
    };
    const message =
      typeof object.error?.message === 'string'
        ? object.error.message
        : typeof object.message === 'string'
          ? object.message
          : null;
    if (message) {
      const meta: string[] = [];
      if (typeof object.error?.type === 'string') meta.push(`type: ${object.error.type}`);
      if (typeof object.error?.code === 'string' && object.error.code !== object.error.type) {
        meta.push(`code: ${object.error.code}`);
      }
      if (typeof object.error?.param === 'string') meta.push(`param: ${object.error.param}`);
      const requestId = /request_id:\s*([a-z0-9-]+)/i.exec(message)?.[1] ?? null;
      return {
        headline: message.replace(/\s*\(request_id:[^)]*\)/i, '').trim(),
        meta,
        requestId,
        raw: text,
      };
    }
  }

  return {
    headline: text.split('\n')[0].slice(0, 400),
    meta: [],
    requestId: null,
    raw: text,
  };
}
