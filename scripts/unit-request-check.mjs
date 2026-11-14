import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = path.resolve('.tmp-unit');
fs.rmSync(outDir, { recursive: true, force: true });
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    lib: { entry: path.resolve('src/lib/request.ts'), formats: ['es'], fileName: 'request' },
    outDir,
    emptyOutDir: true,
    minify: false,
    target: 'node22',
  },
});
const { buildRequestBody } = await import(pathToFileURL(path.join(outDir, 'request.js')).href);

const results = [];
const check = (ok, label) => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`);

const base = {
  params: {},
  extraBody: '',
  messages: [{ id: 'm1', role: 'user', content: 'hi' }],
  rawMode: false,
  rawBody: '',
};
const deepseek = {
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com',
  path: '/chat/completions',
  method: 'POST',
  model: 'deepseek-flash',
  apiKey: '',
  stream: false,
  headers: [],
};

// 1. DeepSeek 应用扩展
const r1 = buildRequestBody({
  ...base,
  endpoint: deepseek,
  params: {
    server_tools: 'deepseek_web_search\ndeepseek_read_url',
    safety_level: 'high',
    title_enabled: 'true',
  },
});
const b1 = JSON.parse(r1.body);
check(
  Array.isArray(b1.tools) &&
    b1.tools.some((t) => t.name === 'deepseek_web_search') &&
    b1.tools.some((t) => t.name === 'deepseek_read_url'),
  'DeepSeek server tools 写入 tools',
);
check(b1.safety_check?.level === 'high', 'DeepSeek safety_check.level');
check(b1.title?.enabled === true, 'DeepSeek title.enabled');

// 2. 非 DeepSeek 端点不注入
const r2 = buildRequestBody({
  ...base,
  endpoint: { ...deepseek, baseUrl: 'http://127.0.0.1:5399' },
  params: { server_tools: 'deepseek_web_search', safety_level: 'high', title_enabled: 'true' },
});
const b2 = JSON.parse(r2.body);
check(!b2.tools && !b2.safety_check && !b2.title, '非 DeepSeek 端点不注入扩展字段');

// 3. Responses 协议
const r3 = buildRequestBody({
  ...base,
  endpoint: { ...deepseek, protocol: 'deepseek-responses', path: '/responses' },
  params: { server_tools: 'deepseek_web_search', safety_level: 'low', title_enabled: 'true' },
});
const b3 = JSON.parse(r3.body);
check(Array.isArray(b3.input) && b3.input.length === 1, 'Responses input 数组');
check(Array.isArray(b3.tools) && b3.tools[0]?.name === 'deepseek_web_search', 'Responses server tools');
check(b3.safety_check?.level === 'low' && b3.title?.enabled === true, 'Responses safety/title');

// 4. Anthropic 协议
const r4 = buildRequestBody({
  ...base,
  endpoint: { ...deepseek, protocol: 'anthropic-messages', baseUrl: 'https://api.deepseek.com/anthropic', path: '/v1/messages' },
  params: { server_tools: 'deepseek_read_url', safety_level: 'high' },
});
const b4 = JSON.parse(r4.body);
check(b4.max_tokens === 4096, 'Anthropic max_tokens 默认 4096');
check(Array.isArray(b4.tools) && b4.tools[0]?.name === 'deepseek_read_url', 'Anthropic server tools');
check(b4.safety_check?.level === 'high', 'Anthropic safety_check');

// 5. MiniMax max_tokens 改写
const r5 = buildRequestBody({
  ...base,
  endpoint: { ...deepseek, protocol: 'minimax-chat', baseUrl: 'https://api.minimaxi.com', path: '/v1/text/chatcompletion_v2' },
  params: { max_tokens: '512', tool_choice: 'required' },
});
const b5 = JSON.parse(r5.body);
check(b5.max_completion_tokens === 512 && b5.max_tokens === undefined, 'MiniMax max_tokens 改写');
check(b5.tool_choice === undefined, 'MiniMax 非法 tool_choice 被移除');

// 6. RAW 模式完全尊重手写
const r6 = buildRequestBody({
  ...base,
  endpoint: deepseek,
  rawMode: true,
  rawBody: '{"model":"x","messages":[]}',
});
check(JSON.parse(r6.body).model === 'x', 'RAW 模式原样发送');

const failures = results.filter((item) => item.startsWith('FAIL'));
console.log(JSON.stringify({ results, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
