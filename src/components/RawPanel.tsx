import { useMemo } from 'react';
import { useStudio } from '../state/studio';
import { importRawBody, type BuildResult } from '../lib/params';
import { joinUrl, parseJson } from '../lib/utils';
import { Button, CopyButton, toast } from './ui';
import { Icon } from './Icons';

function buildCurl(
  url: string,
  endpoint: { method: string; headers: Record<string, string> },
  body: string,
): string {
  const lines = [`curl -X ${endpoint.method} '${url}'`];
  const headers = { ...endpoint.headers };
  delete headers['content-type'];
  delete headers.authorization;
  lines.push(`  -H 'authorization: Bearer $LLM_API_KEY'`);
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`  -H '${key}: ${value}'`);
  }
  lines.push(`  -H 'content-type: application/json'`);
  lines.push(`  -d '${body.replace(/'/g, `'\\''`)}'`);
  return lines.join(' \\\n');
}

export function RawPanel({ build }: { build: BuildResult }) {
  const { state, dispatch } = useStudio();
  const workspace = state.workspace;
  const endpoint = workspace.endpoint;

  const text = workspace.rawMode ? workspace.rawBody : build.body;
  const parsed = parseJson(text);
  const parseError = parsed.ok ? null : parsed.error;
  const url = joinUrl(endpoint.baseUrl, endpoint.path);

  const headers: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = { 'content-type': 'application/json' };
    if (endpoint.apiKey.trim()) out.authorization = `Bearer ${endpoint.apiKey.trim()}`;
    for (const row of endpoint.headers) {
      if (row.enabled && row.name.trim()) out[row.name.trim()] = row.value;
    }
    return out;
  }, [endpoint]);

  const curl = useMemo(
    () => buildCurl(url, { method: endpoint.method, headers }, text),
    [url, endpoint.method, headers, text],
  );

  const format = () => {
    if (!parsed.ok) {
      toast(`JSON 无效，无法格式化：${parsed.error}`, 'error');
      return;
    }
    dispatch({ type: 'raw-body', value: JSON.stringify(parsed.value, null, 2) });
  };

  const applyToForm = () => {
    const result = importRawBody(text, workspace);
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    dispatch({
      type: 'workspace/import',
      endpoint: result.endpoint,
      params: result.params,
      extraBody: result.extraBody,
      messages: result.messages,
    });
    toast(
      result.unknownKeys.length
        ? `已拆回表单；${result.unknownKeys.length} 个未知字段放入「额外参数」`
        : '已把 RAW 请求体拆回表单',
      'success',
    );
  };

  return (
    <div className="ds-raw">
      <div className="ds-raw__bar">
        <span className={`ds-modechip ${workspace.rawMode ? 'is-raw' : ''}`}>
          <Icon name={workspace.rawMode ? 'pencil' : 'settings'} size={11} />
          {workspace.rawMode ? 'RAW 手写' : '表单生成'}
        </span>
        <span className={`ds-valid ${parseError ? 'is-error' : 'is-ok'}`}>
          {parseError ? `JSON 无效：${parseError}` : 'JSON 合法'}
        </span>
        <span className="ds-spacer" />
        {workspace.rawMode && (
          <Button variant="ghost" icon="refresh" onClick={() => dispatch({ type: 'raw-mode', on: false })}>
            回到表单生成
          </Button>
        )}
        <Button variant="ghost" icon="code" onClick={format}>
          格式化
        </Button>
        <Button variant="ghost" icon="upload" onClick={applyToForm} disabled={Boolean(parseError)}>
          拆回表单
        </Button>
        <CopyButton text={text} label="复制请求体" />
      </div>

      <div className="ds-raw__editor">
        <textarea
          className={`ds-codearea ${parseError ? 'is-invalid' : ''}`}
          value={text}
          spellCheck={false}
          onChange={(event) => dispatch({ type: 'raw-body', value: event.target.value })}
        />
      </div>

      {build.error && (
        <div className="ds-alert is-error">
          <Icon name="alert" size={13} />
          <pre>{build.error}</pre>
        </div>
      )}
      {build.warnings.length > 0 && (
        <div className="ds-alert is-warn">
          <Icon name="alert" size={13} />
          <ul>
            {build.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="ds-raw__meta">
        <div className="ds-kv">
          <span>URL</span>
          <code>{url || '—'}</code>
        </div>
        <div className="ds-kv">
          <span>字节</span>
          <code>{new Blob([text]).size.toLocaleString('en-US')}</code>
        </div>
        <div className="ds-kv">
          <span>headers</span>
          <code>{Object.keys(headers).length}</code>
        </div>
      </div>

      <details className="ds-sub ds-raw__details">
        <summary>实际发送的 headers · {Object.keys(headers).length}</summary>
        <table className="ds-table">
          <tbody>
            {Object.entries(headers).map(([key, value]) => (
              <tr key={key}>
                <td>{key}</td>
                <td className="is-mono">
                  {/authorization|api-key/i.test(key) ? `${value.slice(0, 10)}…••••` : value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details className="ds-sub ds-raw__details">
        <summary>curl 等价命令 · 便于在终端复现</summary>
        <div className="ds-curl">
          <pre>{curl}</pre>
          <CopyButton text={curl} label="复制 curl" />
        </div>
      </details>
    </div>
  );
}
