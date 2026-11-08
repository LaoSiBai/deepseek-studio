import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StudioProvider, useStudio } from './state/studio';
import type { Endpoint, Message, RunRecord, RunState, Workspace } from './types';
import { buildRequestBody } from './lib/params';
import { ApiError, runChatRequest, type RunEvent, type RunOutcome } from './lib/api';
import { clone, joinUrl, truncate, uid } from './lib/utils';
import { onRestoreRun } from './lib/runBridge';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { EndpointPanel } from './components/EndpointPanel';
import { MessagesPanel } from './components/MessagesPanel';
import { ParamsPanel } from './components/ParamsPanel';
import { RawPanel } from './components/RawPanel';
import { ResponsePanel } from './components/ResponsePanel';
import { ChatPanel } from './components/ChatPanel';
import { ToastHost, toast } from './components/ui';
import { Icon } from './components/Icons';

type WorkTab = 'messages' | 'params' | 'raw';
type Mode = 'studio' | 'chat';

const WORK_TABS: { id: WorkTab; label: string }[] = [
  { id: 'messages', label: '上下文' },
  { id: 'params', label: '参数' },
  { id: 'raw', label: '请求体' },
];

const MODE_KEY = 'dss.mode.v1';

function applyRunEvent(run: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'request':
      return { ...run, requestUrl: event.url, requestHeaders: event.headers, requestBody: event.body };
    case 'status':
      return { ...run, httpStatus: event.status, responseHeaders: event.headers };
    case 'first-byte':
      return { ...run, ttftMs: event.at };
    case 'delta':
      return {
        ...run,
        content: run.content + (event.content ?? ''),
        reasoning: run.reasoning + (event.reasoning ?? ''),
        toolCalls: event.toolCalls ?? run.toolCalls,
      };
    case 'usage':
      return { ...run, usage: event.usage };
    case 'finish':
      return { ...run, finishReason: event.finishReason };
    case 'frame':
      return {
        ...run,
        frames: [
          ...run.frames,
          { index: run.frames.length, t: event.at, kind: event.kind, text: event.text.slice(0, 2000) },
        ],
      };
    case 'raw':
      return { ...run, rawResponse: event.text };
    default:
      return run;
  }
}

function Studio() {
  const { state, dispatch } = useStudio();
  const [tab, setTab] = useState<WorkTab>('messages');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'chat' ? 'chat' : 'studio';
    } catch {
      return 'studio';
    }
  });
  const [run, setRun] = useState<RunState | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'edit' | 'response'>('edit');
  const abortRef = useRef<AbortController | null>(null);
  const pendingEvents = useRef<RunEvent[]>([]);
  const flushTimer = useRef<number | null>(null);

  const toggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      setDrawerOpen((value) => !value);
    } else {
      setSidebarCollapsed((value) => !value);
    }
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const changeMode = useCallback((next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* 隐私模式忽略 */
    }
  }, []);

  /** 流式事件先进缓冲，每 50ms 批量提交一次，避免每个 token 都重渲染整棵树 */
  const flushRunEvents = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const events = pendingEvents.current;
    pendingEvents.current = [];
    if (events.length === 0) return;
    setRun((prev) =>
      events.reduce<RunState | null>(
        (state, event) => (state ? applyRunEvent(state, event) : state),
        prev,
      ),
    );
  }, []);

  const queueRunEvent = useCallback(
    (event: RunEvent) => {
      pendingEvents.current.push(event);
      if (flushTimer.current === null) {
        flushTimer.current = window.setTimeout(() => {
          flushTimer.current = null;
          flushRunEvents();
        }, 50);
      }
    },
    [flushRunEvents],
  );

  const build = useMemo(() => buildRequestBody(state.workspace), [state.workspace]);
  const running = run?.phase === 'running';
  const canSend = !running && !build.error;
  const paramCount = useMemo(
    () => Object.values(state.workspace.params).filter((value) => value?.trim()).length,
    [state.workspace.params],
  );

  const pushHistory = useCallback(
    (input: {
      id: string;
      endpoint: Endpoint;
      params: Record<string, string | undefined>;
      messages: Message[];
      extraBody: string;
      body: string;
      status: number | null;
      durationMs: number;
      ttftMs: number | null;
      usage: RunState['usage'];
      finishReason: string | null;
      content: string;
      reasoning: string;
      error: string | null;
    }) => {
      const record: RunRecord = {
        id: input.id,
        at: Date.now(),
        label: `${input.endpoint.model} · ${input.messages.length} 条消息`,
        endpoint: { ...input.endpoint, apiKey: '' },
        params: { ...input.params },
        extraBody: input.extraBody,
        messages: clone(input.messages),
        status: input.status,
        durationMs: input.durationMs,
        ttftMs: input.ttftMs,
        usage: input.usage,
        finishReason: input.finishReason,
        content: truncate(input.content, 12000),
        reasoning: truncate(input.reasoning, 12000),
        error: input.error,
        requestBody: truncate(input.body, 12000),
        stream: input.endpoint.stream,
      };
      dispatch({ type: 'history/push', record });
    },
    [dispatch],
  );

  const send = useCallback(async (override?: Workspace): Promise<RunOutcome | null> => {
    if (abortRef.current) return null;
    const workspace = override ?? state.workspace;
    const snapshot = buildRequestBody(workspace);
    if (snapshot.error) {
      toast(snapshot.error.split('\n')[0], 'error');
      setTab('raw');
      return null;
    }

    const endpoint = workspace.endpoint;
    const params = workspace.params;
    const messages = workspace.messages;
    const extraBody = workspace.extraBody;
    const body = snapshot.body;
    const controller = new AbortController();
    abortRef.current = controller;
    const id = uid('run');
    const startedAt = performance.now();
    const acc = { content: '', reasoning: '' };
    let usage: RunState['usage'] = null;
    let finishReason: string | null = null;

    pendingEvents.current = [];
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }

    setRun({
      id,
      phase: 'running',
      startedAt,
      httpStatus: null,
      content: '',
      reasoning: '',
      toolCalls: [],
      usage: null,
      finishReason: null,
      error: null,
      ttftMs: null,
      durationMs: 0,
      frames: [],
      rawResponse: '',
      responseHeaders: {},
      requestUrl: '',
      requestHeaders: {},
      requestBody: body,
      stream: endpoint.stream,
      contentTruncated: false,
    });

    try {
      const outcome = await runChatRequest({
        endpoint,
        body,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'delta') {
            if (event.content) acc.content += event.content;
            if (event.reasoning) acc.reasoning += event.reasoning;
          }
          if (event.type === 'usage') usage = event.usage;
          if (event.type === 'finish') finishReason = event.finishReason;
          queueRunEvent(event);
        },
      });
      flushRunEvents();
      const durationMs = performance.now() - startedAt;
      setRun((prev) =>
        prev
          ? {
              ...prev,
              phase: 'done',
              durationMs,
              ttftMs: prev.ttftMs ?? outcome.ttftMs,
              usage: outcome.usage ?? prev.usage,
              finishReason: outcome.finishReason ?? prev.finishReason,
              rawResponse: outcome.rawResponse || prev.rawResponse,
            }
          : prev,
      );
      pushHistory({
        id,
        endpoint,
        params,
        messages,
        extraBody,
        body,
        status: outcome.httpStatus,
        durationMs,
        ttftMs: outcome.ttftMs,
        usage: outcome.usage,
        finishReason: outcome.finishReason,
        content: outcome.content,
        reasoning: outcome.reasoning,
        error: null,
      });
      return outcome;
    } catch (err) {
      flushRunEvents();
      const durationMs = performance.now() - startedAt;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setRun((prev) => (prev ? { ...prev, phase: 'aborted', durationMs } : prev));
        pushHistory({
          id,
          endpoint,
          params,
          messages,
          extraBody,
          body,
          status: null,
          durationMs,
          ttftMs: null,
          usage,
          finishReason,
          content: acc.content,
          reasoning: acc.reasoning,
          error: '请求被取消',
        });
      } else {
        const status = err instanceof ApiError ? err.status : null;
        const message =
          err instanceof ApiError
            ? err.body || err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setRun((prev) => (prev ? { ...prev, phase: 'error', httpStatus: status, error: message, durationMs } : prev));
        pushHistory({
          id,
          endpoint,
          params,
          messages,
          extraBody,
          body,
          status,
          durationMs,
          ttftMs: null,
          usage,
          finishReason,
          content: acc.content,
          reasoning: acc.reasoning,
          error: message,
        });
      }
      return null;
    } finally {
      abortRef.current = null;
      pendingEvents.current = [];
      if (flushTimer.current !== null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    }
  }, [state.workspace, pushHistory, queueRunEvent, flushRunEvents]);

  /** Chat 模式：先落一条 user 消息，再把整段上下文发出去，成功后追加 assistant */
  const sendChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const messages = state.workspace.messages;
      const last = messages[messages.length - 1];
      const base =
        last && last.role === 'user' && !last.content.trim() && !last.images?.length
          ? messages.slice(0, -1)
          : messages;
      const userMessage: Message = { id: uid('m'), role: 'user', content: trimmed };
      const nextMessages = [...base, userMessage];
      dispatch({ type: 'messages/set', messages: nextMessages });
      const outcome = await send({ ...state.workspace, messages: nextMessages });
      if (outcome && (outcome.content || outcome.toolCalls.length > 0)) {
        dispatch({
          type: 'message/append',
          message: {
            id: uid('m'),
            role: 'assistant',
            content: outcome.content,
            reasoning_content: outcome.reasoning || undefined,
            tool_calls:
              outcome.toolCalls.length > 0 ? clone(outcome.toolCalls) : undefined,
          },
        });
      }
    },
    [state.workspace, dispatch, send],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const appendAssistant = useCallback(() => {
    if (!run) return;
    const message: Message = {
      id: uid('m'),
      role: 'assistant',
      content: run.content,
      reasoning_content: run.reasoning || undefined,
      tool_calls: run.toolCalls.length > 0 ? clone(run.toolCalls) : undefined,
    };
    dispatch({ type: 'messages/set', messages: [...state.workspace.messages, message] });
    setTab('messages');
    toast('已追加为 assistant 消息，可直接编辑后再发送', 'success');
  }, [run, state.workspace.messages, dispatch]);

  useEffect(() => {
    if (run?.phase !== 'running') return;
    const started = run.startedAt;
    const timer = setInterval(() => {
      setRun((prev) =>
        prev && prev.phase === 'running' ? { ...prev, durationMs: performance.now() - started } : prev,
      );
    }, 200);
    return () => clearInterval(timer);
  }, [run?.phase, run?.startedAt]);

  useEffect(
    () =>
      onRestoreRun((record) => {
        const rawResponse = JSON.stringify(
          {
            note: '从历史记录恢复（非原始响应字节）',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: record.content,
                  ...(record.reasoning ? { reasoning_content: record.reasoning } : {}),
                },
                finish_reason: record.finishReason,
              },
            ],
            usage: record.usage,
          },
          null,
          2,
        );
        setRun({
          id: record.id,
          phase: record.error === '请求被取消' ? 'aborted' : record.error ? 'error' : 'done',
          startedAt: record.at,
          httpStatus: record.status,
          content: record.content,
          reasoning: record.reasoning,
          toolCalls: [],
          usage: record.usage,
          finishReason: record.finishReason,
          error: record.error,
          ttftMs: record.ttftMs,
          durationMs: record.durationMs,
          frames: [],
          rawResponse,
          responseHeaders: {},
          requestUrl: joinUrl(record.endpoint.baseUrl, record.endpoint.path),
          requestHeaders: { 'content-type': 'application/json' },
          requestBody: record.requestBody,
          stream: record.stream,
          contentTruncated: record.content.includes('已截断'),
        });
        setTab('messages');
      }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mode !== 'chat' && mod && event.key === 'Enter') {
        event.preventDefault();
        void send();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        dispatch({ type: 'preset/save', id: state.activePresetId ?? undefined });
        toast('已保存预设', 'success');
        return;
      }
      if (event.key === 'Escape' && abortRef.current) {
        event.preventDefault();
        abortRef.current.abort();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send, dispatch, state.activePresetId, mode]);

  const buildError = build.error;
  const statusTone = buildError ? 'error' : build.warnings.length ? 'warn' : 'ok';

  return (
    <div
      className={`ds-app mode-${mode} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${drawerOpen ? 'drawer-open' : ''} ${mobilePane === 'response' && mode === 'studio' ? 'show-response' : ''}`}
    >
      <TopBar
        mode={mode}
        onModeChange={changeMode}
        run={run}
        canSend={canSend}
        blockReason={buildError}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onSend={() => void send()}
        onStop={stop}
        mobilePane={mobilePane}
        onTogglePane={() => setMobilePane((value) => (value === 'edit' ? 'response' : 'edit'))}
      />

      <div className="ds-body">
        <MemoSidebar collapsed={sidebarCollapsed} onNavigate={closeDrawer} />
        <div className="ds-mobile-backdrop" onClick={closeDrawer} />

        {mode === 'chat' ? (
          <ChatPanel run={run} running={Boolean(running)} onSend={sendChat} onStop={stop} />
        ) : (
          <>
            <main className="ds-main">
          <MemoEndpointPanel />

          <div className="ds-worktabs">
            {WORK_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ds-tab ${tab === item.id ? 'is-active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.id === 'messages' && <span className="ds-tab__count">{state.workspace.messages.length}</span>}
                {item.id === 'params' && paramCount > 0 && <span className="ds-tab__count">{paramCount}</span>}
                {item.id === 'raw' && buildError && <span className="ds-tab__dot" />}
                {item.id === 'raw' && state.workspace.rawMode && <span className="ds-tab__flag">RAW</span>}
              </button>
            ))}
            <span className="ds-spacer" />
            <span className={`ds-buildstate tone-${statusTone}`}>
              {buildError ? '请求体有误' : build.warnings.length ? `${build.warnings.length} 条提醒` : '请求体就绪'}
            </span>
          </div>

          <div className="ds-work">
            {tab === 'messages' && <MemoMessagesPanel />}
            {tab === 'params' && <MemoParamsPanel />}
            {tab === 'raw' && <RawPanel build={build} />}
          </div>

          <footer className="ds-statusbar">
            <Icon name="terminal" size={11} />
            <span className="ds-statusbar__url" title={state.workspace.endpoint.baseUrl + state.workspace.endpoint.path}>
              {state.workspace.endpoint.baseUrl.replace(/^https?:\/\//, '')}
              {state.workspace.endpoint.path}
            </span>
            <span className="ds-spacer" />
            <span className="ds-muted">Ctrl/⌘ + Enter 发送</span>
            <span className="ds-muted">Esc 停止</span>
            <span className="ds-muted">Ctrl/⌘ + S 保存预设</span>
          </footer>
            </main>

            <ResponsePanel
              run={run}
              onAppend={appendAssistant}
              onRetry={() => void send()}
              onStop={stop}
            />
          </>
        )}
      </div>

      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Studio />
    </StudioProvider>
  );
}

const MemoSidebar = memo(Sidebar);
const MemoEndpointPanel = memo(EndpointPanel);
const MemoMessagesPanel = memo(MessagesPanel);
const MemoParamsPanel = memo(ParamsPanel);
