import { useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { useStudio } from '../state/studio';
import type { Message, Role } from '../types';
import { estimateTokens, parseJson } from '../lib/utils';
import { messageToWire } from '../lib/params';
import { readImageFile } from '../lib/images';
import { Icon } from './Icons';
import { IconButton, Select, TextArea, TextInput, toast } from './ui';

const ROLES: Role[] = ['system', 'developer', 'user', 'assistant', 'tool'];

const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: role }));

function messageChars(message: Message): number {
  return (message.content?.length ?? 0) + (message.reasoning_content?.length ?? 0);
}

export function MessagesPanel() {
  const { state, dispatch } = useStudio();
  const messages = state.workspace.messages;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const totalChars = messages.reduce((sum, message) => sum + messageChars(message), 0);
  const imageCount = messages.reduce((sum, message) => sum + (message.images?.length ?? 0), 0);
  const tokens = estimateTokens(JSON.stringify(messages.map(messageToWire)));

  return (
    <div className="ds-messages">
      <div className="ds-messages__meta">
        <span>
          <b>{messages.length}</b> 条消息
        </span>
        <span className="ds-dot-sep" />
        <span>{totalChars.toLocaleString('en-US')} 字符</span>
        <span className="ds-dot-sep" />
        <span>≈ {tokens.toLocaleString('en-US')} tokens</span>
        {imageCount > 0 && (
          <>
            <span className="ds-dot-sep" />
            <span>{imageCount} 张图片（另有 token）</span>
          </>
        )}
        <span className="ds-muted">估算，仅供参考</span>
      </div>

      <div className="ds-messages__list">
        {messages.map((message, index) => (
          <MessageCard
            key={message.id}
            message={message}
            index={index}
            total={messages.length}
            dragging={dragId === message.id}
            dropTarget={overId === message.id && dragId !== message.id}
            onDragStart={() => setDragId(message.id)}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={() => {
              if (dragId && dragId !== message.id) setOverId(message.id);
            }}
            onDrop={() => {
              if (dragId && dragId !== message.id) {
                dispatch({ type: 'message/reorder', fromId: dragId, toId: message.id });
              }
              setDragId(null);
              setOverId(null);
            }}
          />
        ))}
      </div>

      <div className="ds-msg-add">
        <span className="ds-msg-add__label">添加消息</span>
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={`ds-addbtn role-${role}`}
            onClick={() => dispatch({ type: 'message/add', role })}
          >
            <Icon name="plus" size={11} />
            {role}
          </button>
        ))}
      </div>

      <p className="ds-hint-block">
        提示：消息会按顺序进入 <code>messages</code> 数组；assistant 消息可以随意改写（包括 reasoning_content），用来构造任意的多轮上下文。
      </p>
    </div>
  );
}

interface CardProps {
  message: Message;
  index: number;
  total: number;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

function MessageCard({ message, index, total, dragging, dropTarget, onDragStart, onDragEnd, onDragOver, onDrop }: CardProps) {
  const { dispatch } = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Message>) => {
    dispatch({ type: 'message/update', id: message.id, patch });
  };

  const addImages = async (files: File[]) => {
    const next = [...(message.images ?? [])];
    const before = next.length;
    for (const file of files) {
      try {
        next.push(await readImageFile(file));
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      }
    }
    if (next.length > before) update({ images: next });
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    event.preventDefault();
    void addImages(files);
  };

  const rawParsed = parseJson(message.rawJson ?? '');
  const rawInvalid = Boolean(message.raw) && !rawParsed.ok;

  const toggleRaw = () => {
    if (message.raw) {
      const parsed = parseJson<Record<string, unknown>>(message.rawJson ?? '');
      if (!parsed.ok) {
        toast(`JSON 无效：${parsed.error}`, 'error');
        return;
      }
      const object = parsed.value;
      update({
        raw: false,
        role: typeof object.role === 'string' ? (object.role as Role) : message.role,
        content: typeof object.content === 'string' ? object.content : message.content,
        name: typeof object.name === 'string' ? object.name : undefined,
        tool_call_id: typeof object.tool_call_id === 'string' ? object.tool_call_id : undefined,
        reasoning_content:
          typeof object.reasoning_content === 'string' ? object.reasoning_content : undefined,
        tool_calls: Array.isArray(object.tool_calls) ? (object.tool_calls as Message['tool_calls']) : undefined,
      });
    } else {
      update({ raw: true, rawJson: JSON.stringify(messageToWire(message), null, 2) });
    }
  };

  return (
    <article
      className={`ds-msg role-${message.role} ${dragging ? 'is-dragging' : ''} ${dropTarget ? 'is-drop' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', message.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <div className="ds-msg__rail" aria-hidden="true" />
      <div className="ds-msg__inner">
        <header className="ds-msg__head">
          <span className="ds-msg__grip" title="拖拽排序">
            <Icon name="grip" size={12} />
          </span>
          <Select
            className="ds-role-select"
            value={message.role}
            options={ROLE_OPTIONS}
            onChange={(role) => update({ role: role as Role })}
          />
          <span className="ds-msg__index">#{index + 1}</span>
          {message.raw && <span className="ds-msg__flag">JSON</span>}
          {rawInvalid && (
            <span className="ds-msg__flag is-error" title={rawParsed.ok ? '' : rawParsed.error}>
              无效
            </span>
          )}
          <span className="ds-spacer" />
          <span className="ds-msg__chars">{messageChars(message)} 字符</span>
          <IconButton
            icon="arrowUp"
            label="上移"
            size={12}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'message/move', id: message.id, direction: -1 })}
          />
          <IconButton
            icon="arrowDown"
            label="下移"
            size={12}
            disabled={index === total - 1}
            onClick={() => dispatch({ type: 'message/move', id: message.id, direction: 1 })}
          />
          <IconButton
            icon="copy"
            label="复制这条消息"
            size={12}
            onClick={() => dispatch({ type: 'message/duplicate', id: message.id })}
          />
          <IconButton
            icon="code"
            label={message.raw ? '切回普通编辑' : '以完整 JSON 编辑'}
            size={12}
            active={message.raw}
            onClick={toggleRaw}
          />
          <IconButton
            icon="trash"
            label="删除这条消息"
            size={12}
            tone="danger"
            onClick={() => dispatch({ type: 'message/remove', id: message.id })}
          />
        </header>

        {message.raw ? (
          <TextArea
            value={message.rawJson ?? ''}
            onChange={(value) => update({ rawJson: value })}
            mono
            rows={6}
            invalid={rawInvalid}
            placeholder={'{\n  "role": "user",\n  "content": "..." \n}'}
          />
        ) : (
          <TextArea
            value={message.content}
            onChange={(value) => update({ content: value })}
            autoGrow
            rows={2}
            onPaste={message.role === 'user' ? handlePaste : undefined}
            placeholder={
              message.role === 'assistant'
                ? 'assistant 内容，可任意改写后再发给服务器'
                : message.role === 'tool'
                  ? '工具执行结果'
                  : '输入消息内容'
            }
          />
        )}

        {message.role === 'user' && !message.raw && (
          <div className="ds-attach">
            {Boolean(message.images?.length) && (
              <div className="ds-images">
                {message.images?.map((image) => (
                  <div className="ds-image" key={image.id}>
                    {image.url ? (
                      <img src={image.url} alt={image.name} title={image.name} />
                    ) : (
                      <span className="ds-image__missing" title="图片数据不会持久化，请重新添加">
                        未保存
                      </span>
                    )}
                    <button
                      type="button"
                      className="ds-image__remove"
                      title="移除图片"
                      onClick={() =>
                        update({ images: message.images?.filter((item) => item.id !== image.id) })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="ds-attach__bar">
              <button type="button" className="ds-textbtn" onClick={() => fileRef.current?.click()}>
                <Icon name="image" size={11} /> 添加图片
              </button>
              <span className="ds-muted">
                JPEG / PNG / GIF / WebP，也可直接粘贴；图片数据不随工作区持久化
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length > 0) void addImages(files);
                  event.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        {message.role === 'assistant' && !message.raw && (
          <details className="ds-sub" open={Boolean(message.reasoning_content)}>
            <summary>
              reasoning_content
              {message.reasoning_content ? (
                <span className="ds-muted"> · {message.reasoning_content.length} 字符</span>
              ) : (
                <span className="ds-muted"> · 空</span>
              )}
            </summary>
            <TextArea
              value={message.reasoning_content ?? ''}
              onChange={(value) => update({ reasoning_content: value || undefined })}
              mono
              rows={3}
              placeholder="DeepSeek reasoner 的思考内容；部分端点回传历史时会校验该字段"
            />
          </details>
        )}

        {Boolean(message.tool_calls?.length) && !message.raw && (
          <details className="ds-sub">
            <summary>tool_calls · {message.tool_calls?.length}</summary>
            <pre className="ds-json ds-json--tight">{JSON.stringify(message.tool_calls, null, 2)}</pre>
          </details>
        )}

        {(message.role === 'assistant' || message.role === 'tool' || Boolean(message.name) || Boolean(message.tool_call_id)) && !message.raw && (
          <details className="ds-sub" open={message.role === 'tool'}>
            <summary>附加字段</summary>
            {message.role === 'assistant' && (
              <label className="ds-sub__check">
                <input
                  type="checkbox"
                  checked={Boolean(message.prefix)}
                  onChange={(event) => update({ prefix: event.target.checked || undefined })}
                />
                <span>
                  <code>prefix</code> · 前缀续写（Chat Prefix Completion，需 Beta 端点；只有最后一条
                  assistant 生效）
                </span>
              </label>
            )}
            <div className="ds-sub__grid">
              <label className="ds-sub__field">
                <span>name</span>
                <TextInput
                  value={message.name ?? ''}
                  onChange={(value) => update({ name: value || undefined })}
                  placeholder="可选"
                  mono
                />
              </label>
              <label className="ds-sub__field">
                <span>tool_call_id</span>
                <TextInput
                  value={message.tool_call_id ?? ''}
                  onChange={(value) => update({ tool_call_id: value || undefined })}
                  placeholder="tool 消息必填"
                  mono
                />
              </label>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
