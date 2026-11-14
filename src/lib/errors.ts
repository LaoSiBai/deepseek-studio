export interface ErrorSummary {
  headline: string;
  meta: string[];
  requestId: string | null;
  raw: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 把 API 返回的错误整理成「一句主文案 + 元信息 + 原始响应」。
 * 支持 OpenAI/DeepSeek 的 { error: { message } }、MiniMax 的 base_resp、
 * Anthropic 的 { type: 'error', error: { message, type } }，其余退回第一行原文。
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

  const object = asRecord(payload);
  if (object) {
    const requestId = extractRequestId(text);

    // MiniMax：HTTP 200 + base_resp.status_code != 0
    const base = asRecord(object.base_resp);
    if (base && typeof base.status_code === 'number' && base.status_code !== 0) {
      const message =
        typeof base.status_msg === 'string' && base.status_msg
          ? base.status_msg
          : `MiniMax error ${base.status_code}`;
      return {
        headline: message,
        meta: [`status_code: ${base.status_code}`],
        requestId,
        raw: text,
      };
    }

    // Anthropic：{ type: 'error', error: { type, message } }
    if (object.type === 'error') {
      const error = asRecord(object.error);
      if (error && typeof error.message === 'string') {
        const meta: string[] = [];
        if (typeof error.type === 'string') meta.push(`type: ${error.type}`);
        return { headline: error.message, meta, requestId, raw: text };
      }
    }

    // OpenAI / DeepSeek：{ error: { message, type, code, param } } 或顶层 message
    const error = asRecord(object.error);
    const message =
      error && typeof error.message === 'string'
        ? error.message
        : typeof object.message === 'string'
          ? object.message
          : null;
    if (message) {
      const meta: string[] = [];
      if (error && typeof error.type === 'string') meta.push(`type: ${error.type}`);
      if (error && typeof error.code === 'string' && error.code !== error.type) {
        meta.push(`code: ${error.code}`);
      }
      if (error && typeof error.param === 'string') meta.push(`param: ${error.param}`);
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
    requestId: extractRequestId(text),
    raw: text,
  };
}

function extractRequestId(text: string): string | null {
  return /request_id:\s*([a-z0-9-]+)/i.exec(text)?.[1] ?? null;
}
