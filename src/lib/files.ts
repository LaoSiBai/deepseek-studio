import type { Endpoint, FileRef } from '../types';
import { joinUrl } from './utils';

export interface RemoteFile {
  id: string;
  filename?: string;
  bytes?: number;
  purpose?: string;
  created_at?: number;
}

function requireKey(endpoint: Endpoint): string {
  const key = endpoint.apiKey.trim();
  if (!key) {
    throw new Error('上传 / 列出文件需要本地 API key：打开「连接设置」填写，服务端 .env 里的 key 无法直连 Files API');
  }
  return key;
}

/** 直连 Files API（DeepSeek 已允许浏览器跨域）；multipart 上传 */
export async function uploadFile(
  endpoint: Endpoint,
  file: File,
  purpose: FileRef['purpose'],
): Promise<FileRef> {
  const key = requireKey(endpoint);
  const form = new FormData();
  // DeepSeek 要求 purpose 出现在 file 之前
  form.append('purpose', purpose);
  form.append('file', file);
  const response = await fetch(joinUrl(endpoint.baseUrl, '/files'), {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  const json = JSON.parse(text) as { id?: string; filename?: string };
  if (!json.id) throw new Error('上传响应缺少 file id');
  return {
    id: `${json.id}-${Date.now()}`,
    fileId: json.id,
    name: json.filename ?? file.name,
    purpose,
  };
}

export async function listFiles(endpoint: Endpoint): Promise<RemoteFile[]> {
  const key = requireKey(endpoint);
  const response = await fetch(joinUrl(endpoint.baseUrl, '/files?limit=100&order=desc'), {
    headers: { authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  const json = JSON.parse(text) as { data?: RemoteFile[] };
  return json.data ?? [];
}
