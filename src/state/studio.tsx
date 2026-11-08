import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import type {
  Endpoint,
  Message,
  ParamValues,
  Preset,
  Role,
  RunRecord,
  Workspace,
} from '../types';
import { uid } from '../lib/utils';
import { stripImageData } from '../lib/images';

const STORAGE = {
  workspace: 'dss.workspace.v1',
  presets: 'dss.presets.v1',
  history: 'dss.history.v1',
  key: 'dss.key.v1',
  active: 'dss.active.v1',
};

export const DEFAULT_ENDPOINT: Endpoint = {
  baseUrl: 'https://api.deepseek.com',
  path: '/chat/completions',
  method: 'POST',
  model: 'deepseek-flash',
  apiKey: '',
  stream: true,
  headers: [],
};

export function defaultWorkspace(): Workspace {
  return {
    endpoint: { ...DEFAULT_ENDPOINT, headers: [] },
    params: { stream_include_usage: 'true' },
    extraBody: '',
    messages: [{ id: uid('m'), role: 'user', content: '' }],
    rawMode: false,
    rawBody: '',
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function stripKey(endpoint: Endpoint): Endpoint {
  return { ...endpoint, apiKey: '' };
}

function snapshot(workspace: Workspace): Pick<Preset, 'endpoint' | 'params' | 'extraBody' | 'messages'> {
  return {
    endpoint: stripKey(workspace.endpoint),
    params: { ...workspace.params },
    extraBody: workspace.extraBody,
    messages: workspace.messages,
  };
}

export interface StudioState {
  workspace: Workspace;
  presets: Preset[];
  history: RunRecord[];
  activePresetId: string | null;
  dirty: boolean;
}

type Action =
  | { type: 'endpoint'; patch: Partial<Endpoint> }
  | { type: 'header/add' }
  | { type: 'header/update'; id: string; patch: Partial<Endpoint['headers'][number]> }
  | { type: 'header/remove'; id: string }
  | { type: 'param'; key: string; value: string | undefined }
  | { type: 'params/reset' }
  | { type: 'extra'; value: string }
  | { type: 'message/add'; role: Role; afterId?: string }
  | { type: 'message/update'; id: string; patch: Partial<Message> }
  | { type: 'message/append'; message: Message }
  | { type: 'message/remove'; id: string }
  | { type: 'message/move'; id: string; direction: -1 | 1 }
  | { type: 'message/reorder'; fromId: string; toId: string }
  | { type: 'message/duplicate'; id: string }
  | { type: 'messages/set'; messages: Message[] }
  | { type: 'raw-mode'; on: boolean; body?: string }
  | { type: 'raw-body'; value: string }
  | { type: 'workspace/load'; workspace: Workspace }
  | {
      type: 'workspace/import';
      endpoint: Endpoint;
      params: ParamValues;
      extraBody: string;
      messages: Message[];
    }
  | { type: 'workspace/reset' }
  | { type: 'preset/save'; id?: string; name?: string }
  | { type: 'preset/apply'; id: string }
  | { type: 'preset/rename'; id: string; name: string }
  | { type: 'preset/delete'; id: string }
  | { type: 'preset/duplicate'; id: string }
  | { type: 'preset/import'; presets: Preset[] }
  | { type: 'history/push'; record: RunRecord }
  | { type: 'history/clear' }
  | { type: 'history/remove'; id: string };

function withWorkspace(state: StudioState, workspace: Workspace): StudioState {
  return { ...state, workspace, dirty: true };
}

function formsChanged(state: StudioState): Workspace {
  return { ...state.workspace, rawMode: false };
}

function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case 'endpoint':
      return withWorkspace(state, {
        ...state.workspace,
        endpoint: { ...state.workspace.endpoint, ...action.patch },
        rawMode: false,
      });

    case 'header/add':
      return withWorkspace(state, {
        ...state.workspace,
        endpoint: {
          ...state.workspace.endpoint,
          headers: [
            ...state.workspace.endpoint.headers,
            { id: uid('h'), name: '', value: '', enabled: true },
          ],
        },
      });

    case 'header/update':
      return withWorkspace(state, {
        ...state.workspace,
        endpoint: {
          ...state.workspace.endpoint,
          headers: state.workspace.endpoint.headers.map((row) =>
            row.id === action.id ? { ...row, ...action.patch } : row,
          ),
        },
      });

    case 'header/remove':
      return withWorkspace(state, {
        ...state.workspace,
        endpoint: {
          ...state.workspace.endpoint,
          headers: state.workspace.endpoint.headers.filter((row) => row.id !== action.id),
        },
      });

    case 'param': {
      const params: ParamValues = { ...state.workspace.params };
      if (action.value === undefined || action.value === '') delete params[action.key];
      else params[action.key] = action.value;
      return withWorkspace(state, { ...formsChanged(state), params });
    }

    case 'params/reset':
      return withWorkspace(state, { ...formsChanged(state), params: {} });

    case 'extra':
      return withWorkspace(state, { ...formsChanged(state), extraBody: action.value });

    case 'message/add': {
      const message: Message = { id: uid('m'), role: action.role, content: '' };
      const messages = [...state.workspace.messages];
      if (action.afterId) {
        const index = messages.findIndex((item) => item.id === action.afterId);
        messages.splice(index >= 0 ? index + 1 : messages.length, 0, message);
      } else {
        messages.push(message);
      }
      return withWorkspace(state, { ...formsChanged(state), messages });
    }

    case 'message/update':
      return withWorkspace(state, {
        ...formsChanged(state),
        messages: state.workspace.messages.map((message) =>
          message.id === action.id ? { ...message, ...action.patch } : message,
        ),
      });

    case 'message/append':
      return withWorkspace(state, {
        ...state.workspace,
        messages: [...state.workspace.messages, action.message],
      });

    case 'message/remove':
      return withWorkspace(state, {
        ...formsChanged(state),
        messages: state.workspace.messages.filter((message) => message.id !== action.id),
      });

    case 'message/move': {
      const messages = [...state.workspace.messages];
      const index = messages.findIndex((message) => message.id === action.id);
      const next = index + action.direction;
      if (index < 0 || next < 0 || next >= messages.length) return state;
      [messages[index], messages[next]] = [messages[next], messages[index]];
      return withWorkspace(state, { ...formsChanged(state), messages });
    }

    case 'message/reorder': {
      const messages = [...state.workspace.messages];
      const from = messages.findIndex((message) => message.id === action.fromId);
      const to = messages.findIndex((message) => message.id === action.toId);
      if (from < 0 || to < 0 || from === to) return state;
      const [moved] = messages.splice(from, 1);
      messages.splice(to, 0, moved);
      return withWorkspace(state, { ...formsChanged(state), messages });
    }

    case 'message/duplicate': {
      const index = state.workspace.messages.findIndex((message) => message.id === action.id);
      if (index < 0) return state;
      const source = state.workspace.messages[index];
      const copy: Message = { ...source, id: uid('m') };
      const messages = [...state.workspace.messages];
      messages.splice(index + 1, 0, copy);
      return withWorkspace(state, { ...formsChanged(state), messages });
    }

    case 'messages/set':
      return withWorkspace(state, { ...formsChanged(state), messages: action.messages });

    case 'raw-mode':
      return withWorkspace(state, {
        ...state.workspace,
        rawMode: action.on,
        rawBody: action.body ?? state.workspace.rawBody,
      });

    case 'raw-body':
      return withWorkspace(state, { ...state.workspace, rawMode: true, rawBody: action.value });

    case 'workspace/load':
      return {
        ...state,
        workspace: action.workspace,
        activePresetId: null,
        dirty: false,
      };

    case 'workspace/import':
      return withWorkspace(state, {
        ...state.workspace,
        endpoint: { ...action.endpoint, apiKey: state.workspace.endpoint.apiKey },
        params: action.params,
        extraBody: action.extraBody,
        messages: action.messages,
        rawMode: false,
        rawBody: '',
      });

    case 'workspace/reset':
      return { ...state, workspace: defaultWorkspace(), activePresetId: null, dirty: false };

    case 'preset/save': {
      const now = Date.now();
      const data = snapshot(state.workspace);
      const targetId = action.id ?? state.activePresetId;
      if (targetId && state.presets.some((preset) => preset.id === targetId)) {
        return {
          ...state,
          activePresetId: targetId,
          dirty: false,
          presets: state.presets.map((preset) =>
            preset.id === targetId ? { ...preset, ...data, updatedAt: now } : preset,
          ),
        };
      }
      const preset: Preset = {
        id: uid('p'),
        name: action.name ?? `预设 ${state.presets.length + 1}`,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      return {
        ...state,
        presets: [preset, ...state.presets],
        activePresetId: preset.id,
        dirty: false,
      };
    }

    case 'preset/apply': {
      const preset = state.presets.find((item) => item.id === action.id);
      if (!preset) return state;
      return {
        ...state,
        workspace: {
          ...defaultWorkspace(),
          endpoint: { ...preset.endpoint, apiKey: state.workspace.endpoint.apiKey },
          params: { ...preset.params },
          extraBody: preset.extraBody,
          messages: preset.messages.map((message) => ({ ...message })),
          rawMode: false,
        },
        activePresetId: preset.id,
        dirty: false,
      };
    }

    case 'preset/rename':
      return {
        ...state,
        presets: state.presets.map((preset) =>
          preset.id === action.id ? { ...preset, name: action.name, updatedAt: Date.now() } : preset,
        ),
      };

    case 'preset/delete':
      return {
        ...state,
        presets: state.presets.filter((preset) => preset.id !== action.id),
        activePresetId: state.activePresetId === action.id ? null : state.activePresetId,
      };

    case 'preset/duplicate': {
      const preset = state.presets.find((item) => item.id === action.id);
      if (!preset) return state;
      const copy: Preset = {
        ...preset,
        id: uid('p'),
        name: `${preset.name} 副本`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: preset.messages.map((message) => ({ ...message, id: uid('m') })),
      };
      return { ...state, presets: [copy, ...state.presets] };
    }

    case 'preset/import':
      return {
        ...state,
        presets: [...action.presets, ...state.presets].slice(0, 100),
      };

    case 'history/push':
      return { ...state, history: [action.record, ...state.history].slice(0, 40) };

    case 'history/clear':
      return { ...state, history: [] };

    case 'history/remove':
      return { ...state, history: state.history.filter((item) => item.id !== action.id) };

    default:
      return state;
  }
}

function loadInitialState(): StudioState {
  const base = defaultWorkspace();
  const savedKey = safeGet(STORAGE.key) ?? '';

  let workspace = base;
  const savedWorkspace = readJson<Partial<Workspace>>(STORAGE.workspace);
  if (savedWorkspace && savedWorkspace.endpoint) {
    workspace = {
      ...base,
      ...savedWorkspace,
      endpoint: { ...base.endpoint, ...savedWorkspace.endpoint, apiKey: savedKey },
      params: { ...(savedWorkspace.params ?? {}) },
      messages:
        savedWorkspace.messages && savedWorkspace.messages.length
          ? savedWorkspace.messages
          : base.messages,
      rawMode: false,
      rawBody: savedWorkspace.rawBody ?? '',
    };
  }
  workspace.endpoint.apiKey = savedKey;
  if (!workspace.endpoint.baseUrl) workspace.endpoint.baseUrl = base.endpoint.baseUrl;

  const presets = readJson<Preset[]>(STORAGE.presets) ?? [];
  const history = (readJson<RunRecord[]>(STORAGE.history) ?? []).filter(Boolean);
  const activePresetId = safeGet(STORAGE.active);

  return {
    workspace,
    presets,
    history,
    activePresetId: activePresetId && presets.some((preset) => preset.id === activePresetId) ? activePresetId : null,
    dirty: false,
  };
}

function persist(state: StudioState): void {
  try {
    localStorage.setItem(STORAGE.key, state.workspace.endpoint.apiKey);
    localStorage.setItem(
      STORAGE.workspace,
      JSON.stringify({
        ...state.workspace,
        messages: state.workspace.messages.map(stripImageData),
        endpoint: stripKey(state.workspace.endpoint),
        rawBody:
          state.workspace.rawMode && state.workspace.rawBody.length < 500_000
            ? state.workspace.rawBody
            : '',
      }),
    );
    localStorage.setItem(
      STORAGE.presets,
      JSON.stringify(
        state.presets.map((preset) => ({
          ...preset,
          endpoint: stripKey(preset.endpoint),
          messages: preset.messages.map(stripImageData),
        })),
      ),
    );
    localStorage.setItem(
      STORAGE.history,
      JSON.stringify(
        state.history.map((record) => ({
          ...record,
          messages: record.messages.map(stripImageData),
        })),
      ),
    );
    if (state.activePresetId) localStorage.setItem(STORAGE.active, state.activePresetId);
    else localStorage.removeItem(STORAGE.active);
  } catch {
    /* 配额不足等场景静默失败，不阻塞交互 */
  }
}

const StudioContext = createContext<{ state: StudioState; dispatch: Dispatch<Action> } | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  useEffect(() => {
    const timer = setTimeout(() => persist(state), 250);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <StudioContext.Provider value={{ state, dispatch }}>{children}</StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be used inside StudioProvider');
  return context;
}

export type { Action as StudioAction };
