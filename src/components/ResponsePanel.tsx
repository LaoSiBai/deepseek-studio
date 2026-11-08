import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { RunState, StreamFrame } from '../types';
import { downloadText, formatMs, formatNumber } from '../lib/utils';
import { summarizeError } from '../lib/errors';
import { useIsMobile } from '../lib/useMediaQuery';
import { Icon } from './Icons';
import { CopyButton, IconButton } from './ui';
import { JsonView } from './JsonView';
import { MarkdownView } from './Markdown';

type Tab = 'content' | 'raw' | 'frames' | 'headers';
type ContentRender = 'raw' | 'markdown';

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: 'content', label: '内容' },
  { id: 'raw', label: '原始响应' },
  { id: 'frames', label: '流式帧' },
  { id: 'headers', label: '头信息' },
];

interface Props {
  run: RunState | null;
  onAppend: () => void;
  onRetry: () => void;
  onStop: () => void;
}

function statusMeta(run: RunState): { label: string; tone: string } {
  if (run.phase === 'running') return { label: '运行中', tone: 'running' };
  if (run.phase === 'aborted') return { label: '已取消', tone: 'warn' };
  if (run.phase === 'error') return { label: run.httpStatus ? `HTTP ${run.httpStatus}` : '请求失败', tone: 'error' };
  if (run.httpStatus) return { label: `HTTP ${run.httpStatus}`, tone: run.httpStatus < 400 ? 'ok' : 'error' };
  return { label: '完成', tone: 'ok' };
}

function frameTone(kind: StreamFrame['kind']): string {
  switch (kind) {
    case 'delta':
      return 'ok';
    case 'done':
      return 'accent';
    case 'error':
      return 'error';
    case 'usage':
      return 'warn';
    default:
      return 'neutral';
  }
}

const FrameRow = memo(function FrameRow({ frame, dt }: { frame: StreamFrame; dt: number }) {
  return (
    <div className="ds-frame">
      <span className="ds-frame__idx">#{frame.index}</span>
      <span className="ds-frame__t">{frame.t.toFixed(0)}</span>
      <span className="ds-frame__dt">+{dt.toFixed(0)}</span>
      <span className={`ds-frame__kind tone-${frameTone(frame.kind)}`}>{frame.kind}</span>
      <span className="ds-frame__text">{frame.text}</span>
    </div>
  );
});

export function ResponsePanel({ run, onAppend, onRetry, onStop }: Props) {
  const [tab, setTab] = useState<Tab>('content');
  const isMobile = useIsMobile();
  const [view, setView] = useState<ContentRender>(() => {
    try {
      return localStorage.getItem('dss.content.view') === 'raw' ? 'raw' : 'markdown';
    } catch {
      return 'markdown';
    }
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<HTMLDivElement>(null);
  const errorSummary = useMemo(() => summarizeError(run?.error ?? null), [run?.error]);

  const changeView = (next: ContentRender) => {
    setView(next);
    try {
      localStorage.setItem('dss.content.view', next);
    } catch {
      /* 隐私模式下忽略 */
    }
  };

  useEffect(() => {
    setTab('content');
  }, [run?.id]);

  useEffect(() => {
    if (tab !== 'content') return;
    const node = contentRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [run?.content, run?.reasoning, tab]);

  useEffect(() => {
    if (tab !== 'frames') return;
    const node = framesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [run?.frames.length, tab]);

  if (!run) {
    return (
      <aside className="ds-response ds-response--empty">
        <div className="ds-response__head">
          <span className="ds-response__title">响应</span>
        </div>
        <div className="ds-empty">
          <div className="ds-empty__glyph">
            <Icon name="terminal" size={22} />
          </div>
          <p>还没有请求</p>
          <p className="ds-muted">
            {isMobile ? '在「编辑」里填写内容后发送' : '按 Ctrl / ⌘ + Enter 发送，Esc 停止'}
          </p>
        </div>
      </aside>
    );
  }

  const status = statusMeta(run);
  const usage = run.usage;
  const hasBody = Boolean(run.content || run.reasoning || run.toolCalls.length);
  const requestHeaders = Object.entries(run.requestHeaders);

  const start = Math.max(0, run.frames.length - 600);
  const visibleFrames = run.frames.slice(start).map((frame, offset) => {
    const absolute = start + offset;
    const prevT = absolute === 0 ? 0 : run.frames[absolute - 1].t;
    return { frame, dt: frame.t - prevT };
  });

  return (
    <aside className="ds-response">
      <div className="ds-response__head">
        <span className="ds-response__title">响应</span>
        <span className={`ds-status tone-${status.tone}`}>
          {run.phase === 'running' && <span className="ds-pulse" />}
          {status.label}
        </span>
        <span className="ds-spacer" />
        {hasBody && run.phase !== 'running' && (
          <button
            type="button"
            className="ds-textbtn is-accent"
            onClick={onAppend}
            title="把这条响应作为 assistant 消息加入上下文，可编辑后再发送"
          >
            <Icon name="plus" size={11} />
            追加
          </button>
        )}
        {Boolean(run.content) && <CopyButton text={run.content} label="复制正文" />}
        <IconButton
          icon="download"
          label="导出响应"
          onClick={() => downloadText(`response-${run.id}.json`, run.rawResponse || run.content)}
        />
        {run.phase === 'running' ? (
          <button type="button" className="ds-textbtn is-danger" onClick={onStop}>
            停止
          </button>
        ) : (
          <button type="button" className="ds-textbtn" onClick={onRetry} title="用同一份请求重发">
            <Icon name="refresh" size={11} /> 重发
          </button>
        )}
      </div>

      <div className="ds-metrics">
        <div className="ds-metric">
          <span>耗时</span>
          <b>{formatMs(run.durationMs)}</b>
        </div>
        <div className="ds-metric">
          <span>TTFT</span>
          <b>{formatMs(run.ttftMs)}</b>
        </div>
        <div className="ds-metric">
          <span>输出 tokens</span>
          <b>{formatNumber(usage?.completion_tokens)}</b>
        </div>
        <div className="ds-metric">
          <span>输入 tokens</span>
          <b>{formatNumber(usage?.prompt_tokens)}</b>
        </div>
        <div className="ds-metric">
          <span>finish</span>
          <b className={run.finishReason === 'length' ? 'is-warn' : ''}>{run.finishReason ?? '—'}</b>
        </div>
      </div>

      <div className="ds-response__tabs">
        {TAB_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ds-tab ${tab === item.id ? 'is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'frames' && run.frames.length > 0 && (
              <span className="ds-tab__count">{run.frames.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'content' && (
        <div className="ds-response__body" ref={contentRef}>
          {run.error && errorSummary && (
            <div className="ds-errorbox">
              <div className="ds-errorbox__title">
                <Icon name="alert" size={13} />
                请求失败
                {run.httpStatus !== null && <span className="ds-errorbox__status">HTTP {run.httpStatus}</span>}
              </div>
              <p className="ds-errorbox__message">{errorSummary.headline}</p>
              {(errorSummary.meta.length > 0 || errorSummary.requestId) && (
                <div className="ds-errorbox__meta">
                  {errorSummary.meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {errorSummary.requestId && (
                    <span className="ds-errorbox__rid">
                      request_id: {errorSummary.requestId}
                      <CopyButton text={errorSummary.requestId} label="复制 request_id" />
                    </span>
                  )}
                </div>
              )}
              <details className="ds-errorbox__detail">
                <summary>原始响应</summary>
                <pre>{errorSummary.raw}</pre>
              </details>
            </div>
          )}

          {run.reasoning && (
            <details className="ds-reasoning" open>
              <summary>
                思考过程
                <span className="ds-muted"> · {run.reasoning.length} 字符</span>
              </summary>
              <div className="ds-reasoning__text">{run.reasoning}</div>
            </details>
          )}

          {run.toolCalls.length > 0 && (
            <div className="ds-toolcalls">
              <div className="ds-blocklabel">tool_calls · {run.toolCalls.length}</div>
              {run.toolCalls.map((call, index) => {
                let args = call.function.arguments;
                try {
                  args = JSON.stringify(JSON.parse(args), null, 2);
                } catch {
                  /* 保留原始字符串 */
                }
                return (
                  <div className="ds-toolcall" key={call.id || index}>
                    <div className="ds-toolcall__head">
                      <Icon name="code" size={12} />
                      <b>{call.function.name || 'function'}</b>
                      <span className="ds-muted">{call.id}</span>
                      <span className="ds-spacer" />
                      <CopyButton text={call.function.arguments} label="复制参数" />
                    </div>
                    <pre>{args || '{}'}</pre>
                  </div>
                );
              })}
            </div>
          )}

          {run.content && (
            <div className="ds-viewbar">
              <div className="ds-segmented" role="group" aria-label="正文渲染方式">
                <button
                  type="button"
                  className={view === 'raw' ? 'is-active' : ''}
                  onClick={() => changeView('raw')}
                  title="按服务器返回的原文显示"
                >
                  原始
                </button>
                <button
                  type="button"
                  className={view === 'markdown' ? 'is-active' : ''}
                  onClick={() => changeView('markdown')}
                  title="解析 Markdown：标题、列表、代码块、表格、链接"
                >
                  Markdown
                </button>
              </div>
            </div>
          )}

          {run.content ? (
            <div className="ds-content">
              {view === 'markdown' ? (
                <MarkdownView text={run.content} />
              ) : (
                <div className="ds-content__text">{run.content}</div>
              )}
              {run.phase === 'running' && <span className="ds-caret" />}
            </div>
          ) : run.phase === 'running' && !run.reasoning ? (
            <div className="ds-waiting">
              <span className="ds-pulse" />
              等待首个 token…
            </div>
          ) : null}

          {!hasBody && run.phase === 'done' && !run.error && (
            <div className="ds-empty ds-empty--inline">
              <p>响应没有可显示的内容</p>
              <p className="ds-muted">切到「原始响应」查看完整 JSON</p>
            </div>
          )}

          {!run.error && run.phase !== 'running' && hasBody && (
            <div className="ds-content__footer">
              <span>{run.content.length.toLocaleString('en-US')} 字符</span>
              {run.reasoning && <span>· 思考 {run.reasoning.length.toLocaleString('en-US')} 字符</span>}
              {run.usage?.completion_tokens_details?.reasoning_tokens ? (
                <span>· reasoning tokens {run.usage.completion_tokens_details.reasoning_tokens}</span>
              ) : null}
            </div>
          )}
        </div>
      )}

      {tab === 'raw' && (
        <div className="ds-response__body">
          {run.rawResponse ? (
            <JsonView text={run.rawResponse} />
          ) : (
            <div className="ds-empty ds-empty--inline">
              <p>还没有响应数据</p>
            </div>
          )}
        </div>
      )}

      {tab === 'frames' && (
        <div className="ds-response__body ds-frames" ref={framesRef}>
          {visibleFrames.length === 0 ? (
            <div className="ds-empty ds-empty--inline">
              <p>暂无流式帧</p>
              <p className="ds-muted">关闭 stream 或等待响应</p>
            </div>
          ) : (
            <>
              {run.frames.length > visibleFrames.length && (
                <div className="ds-frames__cut">仅显示最近 {visibleFrames.length} 帧</div>
              )}
              <div className="ds-frames__head">
                <span>#</span>
                <span>累计 ms</span>
                <span>Δ ms</span>
                <span>类型</span>
                <span>内容</span>
              </div>
              {visibleFrames.map(({ frame, dt }) => (
                <FrameRow key={frame.index} frame={frame} dt={dt} />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'headers' && (
        <div className="ds-response__body ds-headers-view">
          <div className="ds-blocklabel">请求 headers</div>
          {requestHeaders.length === 0 ? (
            <p className="ds-muted">无</p>
          ) : (
            <table className="ds-table">
              <tbody>
                {requestHeaders.map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td className="is-mono">{/authorization|api-key/i.test(key) ? `${value.slice(0, 10)}…••••` : value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="ds-blocklabel">响应 headers</div>
          {Object.keys(run.responseHeaders).length === 0 ? (
            <p className="ds-muted">无</p>
          ) : (
            <table className="ds-table">
              <tbody>
                {Object.entries(run.responseHeaders).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td className="is-mono">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </aside>
  );
}
