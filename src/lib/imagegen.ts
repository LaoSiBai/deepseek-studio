export interface GeneratedImage {
  url?: string;
  b64?: string;
  size?: string;
  revisedPrompt?: string;
  error?: string;
}

export interface ImageGenResult {
  items: GeneratedImage[];
  outputFormat: string;
  usage?: Record<string, unknown>;
}

export interface ImageGenInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  area?: string;
  size?: string;
  n: number;
  responseFormat: 'url' | 'b64_json';
  outputFormat?: 'jpeg' | 'png' | 'webp';
  disablePromptEnhanced?: boolean;
  signal?: AbortSignal;
}

interface RawImageItem {
  url?: unknown;
  b64_json?: unknown;
  size?: unknown;
  revised_prompt?: unknown;
  error?: { message?: unknown };
}

/** MiniMax H3-Image 文生图（POST /v1/images/generations，同步返回） */
export async function generateImages(input: ImageGenInput): Promise<ImageGenResult> {
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: input.n,
    response_format: input.responseFormat,
  };
  if (input.size) body.size = input.size;
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (input.area) body.area = input.area;
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (input.disablePromptEnhanced) body.disable_prompt_enhanced = true;

  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`响应不是合法 JSON：${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const error = json.error as { message?: string } | undefined;
    const baseResp = json.base_resp as { status_msg?: string } | undefined;
    throw new Error(
      (typeof error?.message === 'string' && error.message) ||
        (typeof baseResp?.status_msg === 'string' && baseResp.status_msg) ||
        `HTTP ${response.status}`,
    );
  }

  const data = Array.isArray(json.data) ? (json.data as RawImageItem[]) : [];
  const parsed = data.map((item) => ({
    url: typeof item.url === 'string' ? item.url : undefined,
    b64: typeof item.b64_json === 'string' ? item.b64_json : undefined,
    size: typeof item.size === 'string' ? item.size : undefined,
    revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
    error: typeof item.error?.message === 'string' ? item.error.message : undefined,
  }));
  const items = parsed.filter((item) => item.url || item.b64 || item.error);
  return {
    items,
    outputFormat: typeof json.output_format === 'string' ? json.output_format : 'jpeg',
    usage: (json.usage as Record<string, unknown>) ?? undefined,
  };
}

/** 把生成结果转成可直接下载的 blob URL */
export async function imageToBlobUrl(item: GeneratedImage, outputFormat: string): Promise<string> {
  if (item.b64) return `data:image/${outputFormat};base64,${item.b64}`;
  if (!item.url) throw new Error('这张图没有可用的地址');
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
