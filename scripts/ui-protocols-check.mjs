import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
const check = (ok, label) => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`);

await page.goto('http://127.0.0.1:5300/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// 1. Provider 模板：切 MiniMax 应同时写入 protocol/baseUrl/path/model
const providerSelect = page.locator('.ds-provider select');
await providerSelect.selectOption('minimax');
await page.waitForTimeout(300);
check((await page.getByPlaceholder('https://api.deepseek.com').inputValue()).includes('minimaxi.com'), 'MiniMax 模板写入 baseUrl');
check((await page.getByPlaceholder('/chat/completions').inputValue()) === '/v1/text/chatcompletion_v2', 'MiniMax 模板写入 path');
check((await page.getByPlaceholder('deepseek-chat').inputValue()) === 'MiniMax-M3.1-Flash', 'MiniMax 模板写入 model');

async function applyEndpoint(cfg) {
  await page.evaluate((c) => {
    const key = 'dss.workspace.v1';
    const ws = JSON.parse(localStorage.getItem(key) ?? '{}');
    ws.endpoint = { ...(ws.endpoint ?? {}), ...c };
    localStorage.setItem(key, JSON.stringify(ws));
  }, cfg);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
}

async function send(label, timeout = 3200) {
  await page.locator('.ds-send').click();
  await page.waitForTimeout(timeout);
  const text = await page.locator('.ds-content').innerText().catch(() => '');
  const status = await page.locator('.ds-status').innerText().catch(() => '');
  check(status.includes('HTTP 200'), `${label}: HTTP 200`);
  return text;
}

// 2. MiniMax 流式：正文不重复
await applyEndpoint({
  baseUrl: 'http://127.0.0.1:5399',
  path: '/v1/text/chatcompletion_v2',
  model: 'MiniMax-M3',
  protocol: 'minimax-chat',
  stream: true,
});
const minimaxText = await send('MiniMax 流式');
check(minimaxText.includes('MiniMax 流式'), 'MiniMax 流式正文渲染');
check((minimaxText.match(/MiniMax 流式/g) ?? []).length === 1, 'MiniMax 流式正文不重复');

// 3. MiniMax 业务错误（base_resp）
await applyEndpoint({ model: 'mock-minimax-error' });
await page.locator('.ds-send').click();
await page.locator('.ds-errorbox').waitFor({ timeout: 6000 }).catch(() => {});
await page.waitForTimeout(300);
const minimaxError = await page.locator('.ds-errorbox').innerText().catch(() => '');
check(minimaxError.includes('rate limit'), 'MiniMax base_resp 错误文案');
check(minimaxError.includes('1002'), 'MiniMax 错误码展示');

// 4. Responses 流式
await applyEndpoint({
  baseUrl: 'http://127.0.0.1:5399',
  path: '/responses',
  model: 'deepseek-flash',
  protocol: 'deepseek-responses',
  stream: true,
});
const responsesText = await send('Responses 流式');
check(responsesText.includes('Responses 流式'), 'Responses 流式正文渲染');
const pageText = await page.locator('.ds-app').innerText();
check(/\b36\b|tokens/i.test(pageText), 'Responses usage 展示');

// 5. Anthropic 流式
await applyEndpoint({
  baseUrl: 'http://127.0.0.1:5399',
  path: '/anthropic/v1/messages',
  model: 'deepseek-flash',
  protocol: 'anthropic-messages',
  stream: true,
});
const anthropicText = await send('Anthropic 流式');
check(anthropicText.includes('Anthropic 流式'), 'Anthropic 流式正文渲染');

// 6. OpenAI 非流式回归
await applyEndpoint({
  baseUrl: 'http://127.0.0.1:5399',
  path: '/chat/completions',
  model: 'mock-model',
  protocol: 'openai-chat',
  stream: false,
});
const openaiText = await send('OpenAI 非流式', 1500);
check(openaiText.includes('非流式 mock 响应'), 'OpenAI 非流式回归');

// 7. 旧数据迁移：没有 protocol 的 workspace 加载后应为 openai-chat
await page.evaluate(() => {
  const key = 'dss.workspace.v1';
  const ws = JSON.parse(localStorage.getItem(key) ?? '{}');
  delete ws.endpoint.protocol;
  localStorage.setItem(key, JSON.stringify(ws));
});
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();
const protocolValue = await page.locator('.ds-advanced__block').filter({ hasText: '协议' }).locator('select').inputValue();
check(protocolValue === 'openai-chat', '旧数据 protocol 默认 openai-chat');
check(errors.length === 0, `无 JS 报错 (${errors.length})`);

await page.screenshot({ path: 'C:\\Users\\30775\\AppData\\Local\\Temp\\protocols.png' });
console.log(JSON.stringify({ results, errors, failures: results.filter((r) => r.startsWith('FAIL')) }, null, 2));
await browser.close();
