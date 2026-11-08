import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { studioProxy } from './server/proxy.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.HTTP_PROXY ||
    env.http_proxy ||
    env.LLM_PROXY;
  return {
    // 相对路径，兼容 GitHub Pages 子路径和自定义域名根路径
    base: './',
    plugins: [
      react(),
      studioProxy({
        apiKey: process.env.LLM_API_KEY || env.LLM_API_KEY,
        defaultBaseUrl: process.env.LLM_BASE_URL || env.LLM_BASE_URL,
        proxyUrl,
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 5300,
      strictPort: false,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: false,
    },
  };
});
