import http from 'node:http';

const PORT = Number(process.env.PORT || 5399);

function sse(res, payload, event) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function messageCount(body) {
  return Array.isArray(body.messages) ? body.messages.length : Array.isArray(body.input) ? body.input.length : 0;
}

/** MiniMax 原生 v2：base_resp + choices[].message，流式末帧带完整 message */
function handleMinimax(req, res, body) {
  if (body.model === 'mock-minimax-error') {
    sendJson(res, 200, {
      base_resp: { status_code: 1002, status_msg: 'mock: rate limit exceeded' },
      choices: [],
    });
    return;
  }
  const content = `MiniMax mock 响应。收到 ${messageCount(body)} 条消息，model=${body.model ?? '—'}。`;
  if (body.stream === false) {
    sendJson(res, 200, {
      id: 'mock-minimax',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, reasoning_content: 'MiniMax mock 思考：先确认参数，再回答。' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 13, completion_tokens: 17, total_tokens: 30 },
      base_resp: { status_code: 0, status_msg: '' },
    });
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const deltas = ['MiniMax 流式 ', 'mock 正文，', `收到 ${messageCount(body)} 条消息。`];
  let index = 0;
  const timer = setInterval(() => {
    if (index < deltas.length) {
      sse(res, {
        id: 'mock-minimax',
        choices: [{ index: 0, delta: { content: deltas[index], ...(index === 0 ? { reasoning_content: '思考：' } : {}) } }],
      });
      index += 1;
    } else {
      // 末帧：完整 message（客户端不应重复追加）+ usage + base_resp
      sse(res, {
        id: 'mock-minimax',
        choices: [{ index: 0, message: { role: 'assistant', content: deltas.join('') }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 13, completion_tokens: 17, total_tokens: 30 },
        base_resp: { status_code: 0, status_msg: '' },
      });
      clearInterval(timer);
      res.end();
    }
  }, 60);
}

/** OpenAI Responses：SSE 带 event 名，结束是 response.completed，没有 [DONE] */
function handleResponses(req, res, body) {
  if (body.model === 'mock-responses-error') {
    sendJson(res, 200, { status: 'failed', error: { message: 'mock: responses failed' } });
    return;
  }
  const text = `Responses mock 响应。收到 ${messageCount(body)} 条输入。`;
  if (body.stream === false) {
    sendJson(res, 200, {
      id: 'resp_mock',
      object: 'response',
      status: 'completed',
      model: body.model ?? 'mock',
      output_text: text,
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Responses mock 思考。' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
      ],
      usage: {
        input_tokens: 21,
        output_tokens: 15,
        total_tokens: 36,
        input_tokens_details: { cached_tokens: 8 },
        output_tokens_details: { reasoning_tokens: 6 },
      },
    });
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const chunks = ['Responses 流式 ', 'mock 正文，', `收到 ${messageCount(body)} 条输入。`];
  let index = 0;
  const timer = setInterval(() => {
    if (index === 0) {
      sse(res, { type: 'response.created', response: { id: 'resp_mock', status: 'in_progress' } }, 'response.created');
    }
    if (index < chunks.length) {
      sse(res, { type: 'response.output_text.delta', delta: chunks[index] }, 'response.output_text.delta');
      index += 1;
    } else {
      sse(
        res,
        {
          type: 'response.completed',
          response: {
            id: 'resp_mock',
            status: 'completed',
            usage: {
              input_tokens: 21,
              output_tokens: 15,
              total_tokens: 36,
              input_tokens_details: { cached_tokens: 8 },
            },
          },
        },
        'response.completed',
      );
      clearInterval(timer);
      res.end();
    }
  }, 60);
}

/** Anthropic Messages：message_start / content_block_delta / message_delta / message_stop */
function handleAnthropic(req, res, body) {
  if (body.model === 'mock-anthropic-error') {
    sendJson(res, 200, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'mock: anthropic error' },
    });
    return;
  }
  const text = `Anthropic mock 响应。收到 ${messageCount(body)} 条消息。`;
  if (body.stream === false) {
    sendJson(res, 200, {
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      model: body.model ?? 'mock',
      content: [
        { type: 'thinking', thinking: 'Anthropic mock 思考。' },
        { type: 'text', text },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 19, output_tokens: 14, cache_read_input_tokens: 5 },
    });
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  sse(
    res,
    { type: 'message_start', message: { id: 'msg_mock', role: 'assistant', usage: { input_tokens: 19 } } },
    'message_start',
  );
  sse(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start');
  const chunks = ['Anthropic 流式 ', 'mock 正文，', `收到 ${messageCount(body)} 条消息。`];
  let index = 0;
  const timer = setInterval(() => {
    if (index < chunks.length) {
      sse(
        res,
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[index] } },
        'content_block_delta',
      );
      index += 1;
    } else {
      sse(res, { type: 'content_block_stop', index: 0 }, 'content_block_stop');
      sse(
        res,
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 14 } },
        'message_delta',
      );
      sse(res, { type: 'message_stop' }, 'message_stop');
      clearInterval(timer);
      res.end();
    }
  }, 60);
}

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key, anthropic-version');
  res.setHeader('vary', 'origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const target = req.url ?? '';
  const pathOnly = target.split('?')[0];

  // Files API：列表与上传（不解析 multipart，返回固定 file 对象）
  if (req.method === 'GET' && /\/files\/?$/.test(pathOnly)) {
    sendJson(res, 200, {
      object: 'list',
      data: [
        {
          id: 'file-api-mock-1',
          object: 'file',
          bytes: 1024,
          created_at: 1700000000,
          filename: 'mock-report.pdf',
          purpose: 'text_recognition',
        },
      ],
      first_id: 'file-api-mock-1',
      last_id: 'file-api-mock-1',
      has_more: false,
    });
    return;
  }
  if (req.method === 'POST' && /\/files\/?$/.test(pathOnly)) {
    sendJson(res, 200, {
      id: 'file-api-mock-1',
      object: 'file',
      bytes: 2048,
      created_at: 1700000000,
      filename: 'uploaded.pdf',
      purpose: 'text_recognition',
    });
    return;
  }

  const isMinimax = target.includes('/v1/text/chatcompletion_v2');
  const isResponses = /\/responses\/?$/.test(target);
  const isAnthropic = target.includes('/anthropic') && target.includes('/v1/messages');
  const isFim = /\/completions\/?$/.test(target) && !target.includes('/chat/') && !isMinimax;
  const isChat = target.includes('/chat/completions');
  if (req.method !== 'POST' || (!isMinimax && !isResponses && !isAnthropic && !isFim && !isChat)) {
    sendJson(res, 404, { error: { message: 'mock: not found' } });
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
      sendJson(res, 400, { error: { message: 'mock: invalid json' } });
      return;
    }

    if (isMinimax) {
      handleMinimax(req, res, body);
      return;
    }
    if (isResponses) {
      handleResponses(req, res, body);
      return;
    }
    if (isAnthropic) {
      handleAnthropic(req, res, body);
      return;
    }

    if (isFim) {
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const suffix = typeof body.suffix === 'string' ? body.suffix : '';
      if (body.stream === false) {
        sendJson(res, 200, {
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
        });
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
          sse(res, { choices: [{ index: 0, text: chunks[index], finish_reason: null }] });
          index += 1;
        } else {
          sse(res, {
            choices: [{ index: 0, text: '', finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
          });
          sse(res, '[DONE]');
          clearInterval(timer);
          res.end();
        }
      }, 60);
      return;
    }

    const auth = req.headers.authorization || '(none)';
    const prompt = JSON.stringify(body.messages ?? []);

    if (body.model === 'mock-error') {
      sendJson(res, 400, {
        error: {
          message:
            'Invalid n value (currently only n = 1 is supported) (request_id: mock-8928f92c-0873-4029-89dc-d24e3a35b5df)',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_request_error',
        },
      });
      return;
    }

    if (body.stream === false) {
      sendJson(res, 200, {
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
        usage: {
          prompt_tokens: 11,
          completion_tokens: 9,
          total_tokens: 20,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      });
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
