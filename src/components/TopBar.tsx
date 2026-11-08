import { useStudio } from '../state/studio';
import type { RunState } from '../types';
import { Icon } from './Icons';
import { toast } from './ui';

interface Props {
  mode: 'studio' | 'chat';
  onModeChange: (mode: 'studio' | 'chat') => void;
  run: RunState | null;
  canSend: boolean;
  blockReason: string | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onSend: () => void;
  onStop: () => void;
  mobilePane: 'edit' | 'response';
  onTogglePane: () => void;
}

export function TopBar({
  mode,
  onModeChange,
  run,
  canSend,
  blockReason,
  sidebarCollapsed,
  onToggleSidebar,
  onSend,
  onStop,
  mobilePane,
  onTogglePane,
}: Props) {
  const { state, dispatch } = useStudio();
  const running = run?.phase === 'running';
  const activePreset = state.presets.find((preset) => preset.id === state.activePresetId);

  const save = () => {
    if (!state.workspace.endpoint.model.trim()) {
      toast('先填写 model', 'error');
      return;
    }
    dispatch({ type: 'preset/save', id: state.activePresetId ?? undefined });
    toast(state.activePresetId ? '预设已更新' : '已保存为新预设', 'success');
  };

  return (
    <header className="ds-topbar">
      <div className="ds-brand">
        <button
          type="button"
          className="ds-iconbtn ds-brand__collapse"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          aria-label="切换侧栏"
        >
          <Icon name={sidebarCollapsed ? 'chevronRight' : 'layers'} size={14} />
        </button>
        <span className="ds-brand__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div className="ds-brand__text">
          <span className="ds-brand__name">DeepSeek Studio</span>
          <span className="ds-brand__sub">request lab</span>
        </div>
      </div>

      <div className="ds-topbar__center">
        <div className="ds-modeswitch" role="group" aria-label="工作模式">
          <button
            type="button"
            className={mode === 'studio' ? 'is-active' : ''}
            onClick={() => onModeChange('studio')}
            title="精细构造请求：参数、上下文、原始请求体"
          >
            Studio
          </button>
          <button
            type="button"
            className={mode === 'chat' ? 'is-active' : ''}
            onClick={() => onModeChange('chat')}
            title="聊天模式：自动拼接上下文，消息与 Studio 共用"
          >
            Chat
          </button>
        </div>
        <span className="ds-topbar__workspace" title={activePreset?.name ?? '未保存的工作区'}>
          {activePreset?.name ?? '未命名工作区'}
          {state.dirty && <span className="ds-dirtydot" title="有未保存的修改" />}
        </span>
        <button type="button" className="ds-textbtn" onClick={save} title="保存到预设（Ctrl/⌘ + S）">
          <Icon name="check" size={11} />
          保存
        </button>
        <button
          type="button"
          className="ds-textbtn"
          onClick={() => {
            if (state.dirty && !window.confirm('当前工作区有未保存的修改，确定新建？')) return;
            dispatch({ type: 'workspace/reset' });
            toast('已新建空白工作区');
          }}
          title="新建空白工作区"
        >
          <Icon name="plus" size={11} />
          新建
        </button>
      </div>

      <div className="ds-topbar__right">
        {mode === 'studio' && (
          <button
            type="button"
            className="ds-pane-toggle"
            onClick={onTogglePane}
            title={mobilePane === 'response' ? '回到编辑' : '查看响应'}
            aria-label="切换编辑 / 响应"
          >
            <Icon name={mobilePane === 'response' ? 'pencil' : 'terminal'} size={14} />
          </button>
        )}
        {mode === 'studio' &&
          (running ? (
            <button type="button" className="ds-send is-stop" onClick={onStop} title="停止流式输出（Esc）">
              <Icon name="stop" size={13} />
              停止
            </button>
          ) : (
            <button
              type="button"
              className="ds-send"
              onClick={onSend}
              disabled={!canSend}
              title={blockReason ?? '发送请求（Ctrl / ⌘ + Enter）'}
            >
              <Icon name="play" size={13} />
              发送
            </button>
          ))}
        {mode === 'chat' && running && (
          <button type="button" className="ds-send is-stop" onClick={onStop} title="停止生成（Esc）">
            <Icon name="stop" size={13} />
            停止
          </button>
        )}
        {mode === 'chat' && !running && (
          <span className="ds-topbar__hint" title="在下方输入框按 Enter 发送">
            Enter 发送
          </span>
        )}
      </div>
    </header>
  );
}
