import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:5300/';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:5399';
const outDir = process.env.OUT_DIR || path.join(os.tmpdir(), 'dss-shots');
const failures = [];
const notes = [];

function check(condition, message) {
  if (condition) notes.push(`PASS ${message}`);
  else failures.push(`FAIL ${message}`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// A. 基础配置
await page.getByPlaceholder('https://api.deepseek.com').fill(MOCK);
await page.getByPlaceholder('deepseek-chat').fill('mock-model');
await page.getByPlaceholder('输入消息内容').fill('验证上下文与参数');

// B. 参数：temperature / stop / response_format
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '参数' }).click();
const tempField = page.locator('.ds-field').filter({ hasText: 'temperature' }).first();
await tempField.locator('input').fill('0.3');
const stopField = page.locator('.ds-field').filter({ hasText: 'stop' }).first();
await stopField.locator('textarea').fill('END\nSTOP');
const formatField = page.locator('.ds-field').filter({ hasText: 'response_format' }).first();
await formatField.locator('select').selectOption('json_object');

// C. 请求体应包含参数
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '请求体' }).click();
const body1 = await page.locator('.ds-codearea').inputValue();
check(body1.includes('"temperature": 0.3'), '请求体包含 temperature 0.3');
check(body1.includes('"response_format"') && body1.includes('json_object'), '请求体包含 response_format');
check(body1.includes('"END"') && body1.includes('"STOP"'), 'stop 按行拆成数组');

// C2. 额外参数覆盖表单字段并合并新字段
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '参数' }).click();
await page
  .locator('.ds-group--extra textarea')
  .fill('{"top_k": 42, "temperature": 0.9, "thinking": {"type": "enabled"}}');
await page.waitForTimeout(200);
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '请求体' }).click();
const body1b = await page.locator('.ds-codearea').inputValue();
check(body1b.includes('"top_k": 42'), '额外参数合并进了请求体');
check(body1b.includes('"temperature": 0.9'), '额外参数覆盖了表单里的 temperature');
check(body1b.includes('"thinking"') && body1b.includes('"enabled"'), '额外参数支持嵌套对象');

// D. 发送并等待完成
await page.locator('.ds-send').click();
await page.locator('.ds-status').filter({ hasText: 'HTTP 200' }).waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
const content = await page.locator('.ds-md').innerText();
check(content.includes('mock 流式响应'), '流式内容渲染成功');
check((await page.locator('.ds-reasoning__text').count()) === 1, 'reasoning 区块存在');

// Markdown / 原始切换
await page.locator('.ds-segmented button').filter({ hasText: '原始' }).click();
await page.waitForTimeout(200);
const rawText = await page.locator('.ds-content__text').innerText();
check(rawText.includes('## 参数回显') && rawText.includes('| --- |'), '原始模式显示 Markdown 源码');
await page.locator('.ds-segmented button').filter({ hasText: 'Markdown' }).click();
await page.waitForTimeout(200);
check((await page.locator('.ds-md table').count()) === 1, 'Markdown 模式渲染出表格');
check((await page.locator('.ds-codeblock').count()) === 1, 'Markdown 模式渲染出代码块');
await page.locator('.ds-response__tabs .ds-tab').filter({ hasText: '流式帧' }).click();
await page.waitForTimeout(150);
const frameCount = await page.locator('.ds-frame').count();
check(frameCount > 5, `流式帧已记录 (${frameCount})`);
await page.locator('.ds-response__tabs .ds-tab').filter({ hasText: '内容' }).click();

// E. 追加到上下文
await page.locator('.ds-response__head .ds-textbtn.is-accent').click();
await page.waitForTimeout(250);
check((await page.locator('.ds-msg').count()) === 2, '追加后消息数为 2');
check((await page.locator('.ds-msg.role-assistant .ds-textarea').count()) >= 1, 'assistant 消息可编辑');

// F. 改写 assistant 内容
const assistantTextarea = page.locator('.ds-msg.role-assistant .ds-textarea').first();
await assistantTextarea.fill('这是我手工改写后的 assistant 内容');
await page.waitForTimeout(200);
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '请求体' }).click();
const body2 = await page.locator('.ds-codearea').inputValue();
check(body2.includes('这是我手工改写后的 assistant 内容'), '改写后的 assistant 内容进入请求体');

// G. 保存预设 + 刷新恢复
await page.locator('.ds-topbar .ds-textbtn').filter({ hasText: '保存' }).click();
await page.waitForTimeout(450);
check((await page.locator('.ds-preset').count()) === 1, '预设已保存到侧栏');
const presetName = await page.locator('.ds-preset__name').first().innerText();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);
check((await page.locator('.ds-msg').count()) === 2, '刷新后工作区从 localStorage 恢复');
check((await page.locator('.ds-preset__name').first().innerText()) === presetName, '刷新后预设保留');

// H. 非流式请求
await page.locator('.ds-switch').click();
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '上下文' }).click();
await page.locator('.ds-send').click();
await page.locator('.ds-status').filter({ hasText: 'HTTP 200' }).waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
const nonStream = await page.locator('.ds-md').innerText();
check(nonStream.includes('非流式 mock 响应'), '非流式响应渲染成功');

// I. key 输入与状态
await page.locator('.ds-chip').filter({ hasText: '连接设置' }).click();
await page.locator('input[type="password"]').fill('sk-test-abcdef');
await page.waitForTimeout(200);
const keychip = await page.locator('.ds-keychip').innerText();
check(keychip.includes('本地 key'), '填写 key 后状态变为本地 key');
await page.screenshot({ path: path.join(outDir, '10-connected.png') });

// J. RAW 编辑并拆回表单
await page.locator('.ds-worktabs .ds-tab').filter({ hasText: '请求体' }).click();
const rawBefore = await page.locator('.ds-codearea').inputValue();
check(rawBefore.includes('"mock-model"'), 'RAW 中能看到当前 model');
await page.locator('.ds-codearea').fill(rawBefore.replace('"mock-model"', '"raw-model"'));
await page.waitForTimeout(150);
check((await page.locator('.ds-modechip').innerText()).includes('RAW 手写'), '编辑后进入 RAW 手写模式');
await page.getByRole('button', { name: '拆回表单' }).click();
await page.waitForTimeout(250);
check((await page.getByPlaceholder('deepseek-chat').inputValue()) === 'raw-model', '拆回表单后 model 同步为 raw-model');
check((await page.locator('.ds-modechip').innerText()).includes('表单生成'), '拆回表单后退出 RAW 模式');

// K. 历史记录
await page.locator('.ds-sidebar__tab').filter({ hasText: '历史' }).click();
const historyCount = await page.locator('.ds-history').count();
check(historyCount >= 2, `历史记录已累积 (${historyCount})`);
await page.screenshot({ path: path.join(outDir, '11-final.png') });

check(errors.length === 0, `页面无 JS 报错 (${errors.length})`);

console.log(JSON.stringify({ failures, notes, errors, outDir }, null, 2));
await browser.close();
if (failures.length) process.exitCode = 1;
