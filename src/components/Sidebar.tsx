import { useMemo, useRef, useState } from 'react';
import { useStudio } from '../state/studio';
import type { Preset, RunRecord } from '../types';
import { downloadText, formatMs, formatNumber, timeLabel } from '../lib/utils';
import { restoreRun } from '../lib/runBridge';
import { Icon } from './Icons';
import { IconButton, toast } from './ui';

type Tab = 'presets' | 'history';

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { state, dispatch } = useStudio();
  const [tab, setTab] = useState<Tab>('presets');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const normalized = query.trim().toLowerCase();

  const presets = useMemo(
    () =>
      state.presets.filter(
        (preset) =>
          !normalized ||
          preset.name.toLowerCase().includes(normalized) ||
          preset.endpoint.model.toLowerCase().includes(normalized),
      ),
    [state.presets, normalized],
  );

  const history = useMemo(
    () =>
      state.history.filter(
        (record) =>
          !normalized ||
          record.label.toLowerCase().includes(normalized) ||
          record.endpoint.model.toLowerCase().includes(normalized),
      ),
    [state.history, normalized],
  );

  const loadPreset = (preset: Preset) => {
    dispatch({ type: 'preset/apply', id: preset.id });
    onNavigate?.();
  };

  const loadHistory = (record: RunRecord) => {
    dispatch({
      type: 'workspace/load',
      workspace: {
        endpoint: { ...record.endpoint, apiKey: state.workspace.endpoint.apiKey },
        params: { ...record.params },
        extraBody: record.extraBody,
        messages: record.messages.map((message) => ({ ...message })),
        rawMode: false,
        rawBody: '',
      },
    });
    restoreRun(record);
    toast('已载入这条历史请求与响应', 'success');
    onNavigate?.();
  };

  const exportAll = () => {
    downloadText(
      `deepseek-studio-presets-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), presets: state.presets }, null, 2),
    );
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      const rawList = Array.isArray(data)
        ? data
        : typeof data === 'object' && data !== null && Array.isArray((data as { presets?: unknown }).presets)
          ? (data as { presets: unknown[] }).presets
          : [data];
      const imported = rawList
        .filter((item): item is Preset => typeof item === 'object' && item !== null && 'endpoint' in item && 'messages' in item)
        .map((item) => ({
          ...item,
          id: `p-${Math.random().toString(36).slice(2, 10)}`,
          name: item.name || '导入的预设',
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now(),
          endpoint: { ...item.endpoint, apiKey: '' },
        }));
      if (imported.length === 0) {
        toast('文件里没有可识别的预设', 'error');
        return;
      }
      dispatch({ type: 'preset/import', presets: imported });
      toast(`已导入 ${imported.length} 个预设`, 'success');
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <aside className={`ds-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="ds-sidebar__tabs">
        <button
          type="button"
          className={`ds-sidebar__tab ${tab === 'presets' ? 'is-active' : ''}`}
          onClick={() => setTab('presets')}
        >
          <Icon name="layers" size={12} />
          预设
          <span className="ds-tab__count">{state.presets.length}</span>
        </button>
        <button
          type="button"
          className={`ds-sidebar__tab ${tab === 'history' ? 'is-active' : ''}`}
          onClick={() => setTab('history')}
        >
          <Icon name="history" size={12} />
          历史
          <span className="ds-tab__count">{state.history.length}</span>
        </button>
      </div>

      <div className="ds-sidebar__search">
        <Icon name="search" size={11} />
        <input
          value={query}
          placeholder={tab === 'presets' ? '搜索预设或模型' : '搜索历史'}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} title="清除">
            <Icon name="x" size={10} />
          </button>
        )}
      </div>

      <div className="ds-sidebar__scroll">
        {tab === 'presets' ? (
          presets.length === 0 ? (
            <div className="ds-sidebar__empty">
              <Icon name="layers" size={18} />
              <p>{state.presets.length === 0 ? '还没有预设' : '没有匹配的预设'}</p>
              <p className="ds-muted">调好参数后点击顶栏「保存」</p>
            </div>
          ) : (
            presets.map((preset) => {
              const active = preset.id === state.activePresetId;
              return (
                <div
                  key={preset.id}
                  className={`ds-preset ${active ? 'is-active' : ''}`}
                  onClick={() => loadPreset(preset)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') loadPreset(preset);
                  }}
                >
                  <div className="ds-preset__main">
                    {editingId === preset.id ? (
                      <input
                        className="ds-preset__rename"
                        autoFocus
                        defaultValue={preset.name}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name && name !== preset.name) {
                            dispatch({ type: 'preset/rename', id: preset.id, name });
                          }
                          setEditingId(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                      />
                    ) : (
                      <div
                        className="ds-preset__name"
                        title="双击重命名"
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setEditingId(preset.id);
                        }}
                      >
                        {preset.name}
                      </div>
                    )}
                    <div className="ds-preset__meta">
                      <span>{preset.endpoint.model || '未指定模型'}</span>
                      <span>·</span>
                      <span>{timeLabel(preset.updatedAt)}</span>
                      {active && state.dirty && <span className="ds-preset__dirty">未保存</span>}
                    </div>
                  </div>
                  <div className="ds-preset__actions" onClick={(event) => event.stopPropagation()}>
                    <IconButton
                      icon="refresh"
                      label="用当前工作区更新此预设"
                      size={12}
                      onClick={() => {
                        dispatch({ type: 'preset/save', id: preset.id });
                        toast('预设已更新', 'success');
                      }}
                    />
                    <IconButton
                      icon="copy"
                      label="复制预设"
                      size={12}
                      onClick={() => dispatch({ type: 'preset/duplicate', id: preset.id })}
                    />
                    <IconButton
                      icon="download"
                      label="导出此预设"
                      size={12}
                      onClick={() =>
                        downloadText(
                          `${preset.name.replace(/[\\/:*?"<>|]/g, '_') || 'preset'}.json`,
                          JSON.stringify({ version: 1, presets: [preset] }, null, 2),
                        )
                      }
                    />
                    <IconButton
                      icon="trash"
                      label="删除预设"
                      size={12}
                      tone="danger"
                      onClick={() => {
                        dispatch({ type: 'preset/delete', id: preset.id });
                        toast('预设已删除');
                      }}
                    />
                  </div>
                </div>
              );
            })
          )
        ) : history.length === 0 ? (
          <div className="ds-sidebar__empty">
            <Icon name="history" size={18} />
            <p>{state.history.length === 0 ? '还没有请求记录' : '没有匹配的记录'}</p>
            <p className="ds-muted">每次发送后自动记录</p>
          </div>
        ) : (
          history.map((record) => (
            <div
              key={record.id}
              className="ds-history"
              onClick={() => loadHistory(record)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') loadHistory(record);
              }}
            >
              <span
                className={`ds-history__dot ${
                  record.error || (record.status && record.status >= 400) ? 'is-error' : 'is-ok'
                }`}
              />
              <div className="ds-history__main">
                <div className="ds-history__model">{record.endpoint.model || '未指定模型'}</div>
                <div className="ds-history__meta">
                  <span>{timeLabel(record.at)}</span>
                  <span>·</span>
                  <span>{formatMs(record.durationMs)}</span>
                  <span>·</span>
                  <span>{formatNumber(record.usage?.completion_tokens)} out</span>
                </div>
              </div>
              <div className="ds-history__actions" onClick={(event) => event.stopPropagation()}>
                <IconButton
                  icon="trash"
                  label="删除记录"
                  size={11}
                  tone="danger"
                  onClick={() => dispatch({ type: 'history/remove', id: record.id })}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="ds-sidebar__footer">
        <div className="ds-sidebar__footerrow">
          <button type="button" className="ds-textbtn" onClick={exportAll} disabled={state.presets.length === 0}>
            <Icon name="download" size={11} /> 导出全部
          </button>
          <button type="button" className="ds-textbtn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={11} /> 导入
          </button>
          {tab === 'history' && state.history.length > 0 && (
            <button
              type="button"
              className="ds-textbtn is-danger"
              onClick={() => dispatch({ type: 'history/clear' })}
            >
              清空
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = '';
          }}
        />
      </div>
    </aside>
  );
}
