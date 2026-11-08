import http from 'node:http';

const PORT = Number(process.env.PORT || 5399);

function sse(res, payload) {
  res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
}

const server = http.createServer((req, res) => {
  // 允许浏览器直连（模拟 DeepSeek 的 CORS 行为）
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const target = req.url ?? '';
  const isFim = /\/completions\/?$/.test(target) && !target.includes('/chat/');
  if (req.method !== 'POST' || (!target.includes('/chat/completions') && !isFim)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock: not found' } }));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock: invalid json' } }));
      return;
    }

    if (isFim) {
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const suffix = typeof body.suffix === 'string' ? body.suffix : '';
      if (body.stream === false) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'mock-fim',
            object: 'text_completion',
            model: body.model ?? 'mock',
            choices: [
              {
                index: 0,
                text: `[续写] ${prompt.trim().slice(0, 40)} … ${suffix}`,
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
          }),
        );
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const chunks = ['[续写] ', '这是 FIM ', '流式补全。'];
      let index = 0;
      const timer = setInterval(() => {
        if (index < chunks.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, text: chunks[index], finish_reason: null }] })}\n\n`);
          index += 1;
        } else {
          res.write(
            `data: ${JSON.stringify({
              choices: [{ index: 0, text: '', finish_reason: 'stop' }],
              usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          clearInterval(timer);
          res.end();
        }
      }, 60);
      return;
    }

    const auth = req.headers.authorization || '(none)';
    const prompt = JSON.stringify(body.messages ?? []);

    if (body.model === 'mock-error') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              'Invalid n value (currently only n = 1 is supported) (request_id: mock-8928f92c-0873-4029-89dc-d24e3a35b5df)',
            type: 'invalid_request_error',
            param: null,
            code: 'invalid_request_error',
          },
        }),
      );
      return;
    }

    if (body.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'mock-1',
          object: 'chat.completion',
          model: body.model ?? 'mock',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: `非流式 mock 响应。收到 ${body.messages?.length ?? 0} 条消息。\n参数: ${JSON.stringify({ temp: body.temperature, top_p: body.top_p })}`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 },
        }),
      );
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const deltas = [
      { reasoning_content: '用户希望验证流式链路，' },
      { reasoning_content: '我先回一段思考，再输出正文。' },
      { content: '你好，这是一个 mock 流式响应。\n\n' },
      { content: '## 参数回显\n\n' },
      { content: `收到 ${body.messages?.length ?? 0} 条消息，auth=${auth.slice(0, 12)}。\n\n` },
      { content: '| 参数 | 值 |\n| --- | --- |\n' },
      {
        content: `| temperature | ${body.temperature ?? '—'} |\n| top_p | ${body.top_p ?? '—'} |\n| max_tokens | ${body.max_tokens ?? '—'} |\n\n`,
      },
      { content: '```json\n' },
      { content: '{\n  "model": "mock-model",\n  "stream": true\n}\n' },
      { content: '```\n\n' },
      {
        content:
          '> 以上内容由本地 mock 服务生成，用于验证 **Markdown** 渲染、`行内代码` 与表格排版。',
      },
    ];

    let index = 0;
    const timer = setInterval(() => {
      if (index < deltas.length) {
        sse(res, {
          id: 'mock-chunk',
          object: 'chat.completion.chunk',
          model: body.model ?? 'mock',
          choices: [{ index: 0, delta: deltas[index], finish_reason: null }],
        });
        index += 1;
      } else {
        sse(res, {
          id: 'mock-chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: prompt.length, completion_tokens: 42, total_tokens: prompt.length + 42 },
        });
        sse(res, '[DONE]');
        clearInterval(timer);
        res.end();
      }
    }, 90);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock server on http://127.0.0.1:${PORT}`);
});
