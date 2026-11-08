import { useState } from 'react';
import { useStudio } from '../state/studio';
import type { Endpoint } from '../types';
import { joinUrl } from '../lib/utils';
import { useEnv } from '../lib/useEnv';
import { Icon } from './Icons';
import { Button, IconButton, Select, TextInput } from './ui';

export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    path: '/chat/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'deepseek-beta',
    name: 'DeepSeek Beta',
    baseUrl: 'https://api.deepseek.com/beta',
    path: '/chat/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'deepseek-fim',
    name: 'DeepSeek FIM',
    baseUrl: 'https://api.deepseek.com/beta',
    path: '/completions',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    path: '/chat/completions',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'o3'],
  },
  {
    id: 'custom',
    name: '自定义 / 中转',
    baseUrl: '',
    path: '/chat/completions',
    models: [],
  },
];

function detectProvider(baseUrl: string, path: string) {
  if (baseUrl.includes('api.deepseek.com/beta')) {
    const isFim = /\/completions\/?$/.test(path) && !path.includes('/chat/');
    return isFim ? PROVIDERS[2] : PROVIDERS[1];
  }
  if (baseUrl.includes('api.deepseek.com')) return PROVIDERS[0];
  if (baseUrl.includes('api.openai.com')) return PROVIDERS[3];
  return PROVIDERS[4];
}

export function EndpointPanel() {
  const { state, dispatch } = useStudio();
  const endpoint = state.workspace.endpoint;
  const env = useEnv();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const provider = detectProvider(endpoint.baseUrl, endpoint.path);
  const providerOptions = PROVIDERS.map((item) => ({ value: item.id, label: item.name }));
  const keyState = endpoint.apiKey.trim()
    ? 'local'
    : env?.hasServerKey
      ? 'server'
      : 'missing';

  const patch = (value: Partial<Endpoint>) => dispatch({ type: 'endpoint', patch: value });

  const applyProvider = (id: string) => {
    const next = PROVIDERS.find((item) => item.id === id);
    if (!next) return;
    patch({
      baseUrl: next.baseUrl,
      path: next.path,
      model: next.id === 'custom' ? endpoint.model : next.models[0],
    });
  };

  return (
    <div className="ds-endpoint">
      <div className="ds-endpoint__row">
        <Select className="ds-provider" value={provider.id} options={providerOptions} onChange={applyProvider} />
        <label className="ds-inline">
          <span>base URL</span>
          <TextInput
            mono
            value={endpoint.baseUrl}
            onChange={(value) => patch({ baseUrl: value })}
            placeholder="https://api.deepseek.com"
            title={endpoint.baseUrl}
          />
        </label>
        <label className="ds-inline ds-inline--path">
          <span>path</span>
          <TextInput
            mono
            value={endpoint.path}
            onChange={(value) => patch({ path: value })}
            placeholder="/chat/completions"
            title={endpoint.path}
          />
        </label>
      </div>

      <div className="ds-endpoint__row">
        <label className="ds-inline ds-inline--model">
          <span>model</span>
          <input
            className="ds-input is-mono"
            value={endpoint.model}
            list="dss-model-list"
            spellCheck={false}
            placeholder="deepseek-chat"
            onChange={(event) => patch({ model: event.target.value })}
          />
          <datalist id="dss-model-list">
            {[...new Set(PROVIDERS.flatMap((item) => item.models))].map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>

        <button
          type="button"
          className={`ds-switch ${endpoint.stream ? 'is-on' : ''}`}
          title="是否使用 SSE 流式响应（会写入 body.stream）"
          onClick={() => patch({ stream: !endpoint.stream })}
        >
          <span className="ds-switch__track">
            <span className="ds-switch__thumb" />
          </span>
          stream
        </button>

        <button
          type="button"
          className={`ds-chip ${advancedOpen ? 'is-active' : ''}`}
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          <Icon name="settings" size={12} />
          连接设置
          {endpoint.headers.length > 0 && <span className="ds-chip__count">{endpoint.headers.length}</span>}
        </button>

        <span className="ds-spacer" />

        <button
          type="button"
          className={`ds-keychip is-${keyState}`}
          onClick={() => setAdvancedOpen(true)}
          title={
            keyState === 'local'
              ? '使用浏览器里保存的 key，点击修改'
              : keyState === 'server'
                ? '使用服务端 .env 里的 LLM_API_KEY，点击可覆盖'
                : '还没有可用的 key，点击配置'
          }
        >
          <Icon name="key" size={11} />
          {keyState === 'local' ? '本地 key' : keyState === 'server' ? '.env key' : '配置 key'}
        </button>
      </div>

      {advancedOpen && (
        <div className="ds-endpoint__advanced">
          <div className="ds-advanced__block">
            <div className="ds-advanced__title">
              API Key
              <span className="ds-muted">
                {endpoint.apiKey
                  ? '保存在本机浏览器 localStorage，不会写入预设或导出'
                  : env?.proxyAvailable
                    ? '留空即使用服务端 .env 中的 LLM_API_KEY'
                    : '当前是静态部署（没有本地代理），必须填写 key'}
              </span>
            </div>
            <div className="ds-advanced__keyrow">
              <input
                className="ds-input is-mono"
                type="password"
                value={endpoint.apiKey}
                placeholder={
                  env?.proxyAvailable && env.hasServerKey ? '使用 .env key（可覆盖）' : 'sk-…'
                }
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => patch({ apiKey: event.target.value })}
              />
              {endpoint.apiKey && (
                <Button variant="ghost" onClick={() => patch({ apiKey: '' })}>
                  清除
                </Button>
              )}
            </div>
          </div>

          <div className="ds-advanced__block">
            <div className="ds-advanced__title">
              自定义 headers
              <span className="ds-muted">同名时覆盖自动生成的 authorization</span>
            </div>
            <div className="ds-headers">
              {endpoint.headers.map((row) => (
                <div className="ds-header-row" key={row.id}>
                  <button
                    type="button"
                    className={`ds-check ${row.enabled ? 'is-on' : ''}`}
                    title={row.enabled ? '停用' : '启用'}
                    onClick={() =>
                      dispatch({
                        type: 'header/update',
                        id: row.id,
                        patch: { enabled: !row.enabled },
                      })
                    }
                  >
                    <Icon name="check" size={10} />
                  </button>
                  <input
                    className="ds-input is-mono"
                    value={row.name}
                    placeholder="header-name"
                    spellCheck={false}
                    onChange={(event) =>
                      dispatch({ type: 'header/update', id: row.id, patch: { name: event.target.value } })
                    }
                  />
                  <input
                    className="ds-input is-mono"
                    value={row.value}
                    placeholder="value"
                    spellCheck={false}
                    onChange={(event) =>
                      dispatch({ type: 'header/update', id: row.id, patch: { value: event.target.value } })
                    }
                  />
                  <IconButton
                    icon="x"
                    label="删除"
                    size={12}
                    onClick={() => dispatch({ type: 'header/remove', id: row.id })}
                  />
                </div>
              ))}
              <Button variant="ghost" icon="plus" onClick={() => dispatch({ type: 'header/add' })}>
                添加 header
              </Button>
            </div>
          </div>

          <div className="ds-advanced__url">
            <span>最终 URL</span>
            <code>{joinUrl(endpoint.baseUrl, endpoint.path) || '—'}</code>
          </div>

          <div className="ds-advanced__url">
            <span>传输</span>
            <code>
              {env
                ? env.proxyAvailable
                  ? '本地代理 /api/proxy（可绕过 CORS）'
                  : '浏览器直连（静态部署；需要端点允许跨域）'
                : '检测中…'}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
