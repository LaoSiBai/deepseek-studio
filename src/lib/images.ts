import type { ImageAttachment } from '../types';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function isSupportedImage(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(file.type);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export async function readImageFile(file: File): Promise<ImageAttachment> {
  if (!isSupportedImage(file)) {
    throw new Error(`不支持的格式：${file.type || file.name}（仅 JPEG / PNG / GIF / WebP）`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 20MB：${file.name}`);
  }
  const url = await fileToDataUrl(file);
  if (!url.startsWith('data:image/')) {
    throw new Error(`读取图片失败：${file.name}`);
  }
  return {
    id: `img-${Math.random().toString(36).slice(2, 10)}`,
    name: file.name || '粘贴的图片',
    url,
  };
}

/** 持久化前清掉 base64 数据，只保留文件名占位 */
export function stripImageData<T extends { images?: ImageAttachment[] }>(message: T): T {
  if (!message.images?.length) return message;
  return {
    ...message,
    images: message.images.map((image) => ({ ...image, url: '' })),
  };
}
