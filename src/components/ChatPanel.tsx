import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { useStudio } from '../state/studio';
import type { ImageAttachment, Message, RunState } from '../types';
import { useIsMobile } from '../lib/useMediaQuery';
import { readImageFile } from '../lib/images';
import { MarkdownView } from './Markdown';
import { Icon } from './Icons';
import { toast } from './ui';

interface Props {
  run: RunState | null;
  running: boolean;
  onSend: (text: string, images: ImageAttachment[]) => Promise<void>;
  onSendExisting: () => Promise<void>;
  onStop: () => void;
}

export function ChatPanel({ run, running, onSend, onSendExisting, onStop }: Props) {
  const { state, dispatch } = useStudio();
  const isMobile = useIsMobile();
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const messages = state.workspace.messages;
  const systemMessages = messages.filter(
    (message) => message.role === 'system' && message.content.trim(),
  );
  const conversation = messages.filter(
    (message) =>
      message.role !== 'system' &&
      (message.content.trim() || message.images?.length || message.reasoning_content),
  );

  const lastMessage = messages[messages.length - 1];
  const canResume =
    Boolean(lastMessage) &&
    lastMessage.role === 'user' &&
    Boolean(lastMessage.content.trim() || lastMessage.images?.length);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [conversation.length, run?.content, run?.reasoning, running]);

  const addImages = async (files: File[]) => {
    const next = [...pendingImages];
    const before = next.length;
    for (const file of files) {
      try {
        next.push(await readImageFile(file));
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      }
    }
    if (next.length > before) setPendingImages(next);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    event.preventDefault();
    void addImages(files);
  };

  const submit = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || running) return;
    const images = pendingImages;
    setInput('');
    setPendingImages([]);
    await onSend(text, images);
  };

  const clear = () => {
    if (running) return;
    dispatch({ type: 'messages/set', messages: [] });
    setInput('');
    setPendingImages([]);
  };

  return (
    <section className="ds-chat">
      <header className="ds-chat__head">
        <span className="ds-chat__title">Chat</span>
        <span className="ds-chat__meta">
          {state.workspace.endpoint.model || '未指定模型'} · {conversation.length} 条消息
        </span>
        <span className="ds-spacer" />
        <button
          type="button"
          className="ds-textbtn"
          onClick={clear}
          disabled={running || messages.length === 0}
          title="清空上下文（Studio 中也会同步清空）"
        >
          <Icon name="trash" size={11} /> 清空对话
        </button>
      </header>

      <div className="ds-chat__scroll" ref={scrollRef}>
        <div className="ds-chat__inner">
          {systemMessages.length > 0 && (
            <details className="ds-chat-sys">
              <summary>system 提示词 · {systemMessages.length} 条</summary>
              {systemMessages.map((message) => (
                <div key={message.id}>{message.content}</div>
              ))}
            </details>
          )}

          {conversation.length === 0 && !running && (
            <div className="ds-chat-empty">
              <div className="ds-chat-empty__title">开始对话</div>
              <p>每条消息都会自动拼进上下文；切到 Studio 能看到完整 messages 和请求体。</p>
            </div>
          )}

          {conversation.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {running && (
            <div className="ds-chat-msg is-assistant">
              <div className="ds-chat-bubble">
                {run?.reasoning && (
                  <details className="ds-chat-reason" open>
                    <summary>思考中…</summary>
                    <div className="ds-chat-reason__body">{run.reasoning}</div>
                  </details>
                )}
                {run?.content ? (
                  <MarkdownView text={run.content} />
                ) : (
                  <span className="ds-chat-typing">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            </div>
          )}

          {!running && run?.phase === 'error' && run.error && (
            <div className="ds-chat-error">
              <Icon name="alert" size={12} />
              <span>{run.error.split('\n')[0]}</span>
            </div>
          )}
        </div>
      </div>

      <div className="ds-chat__composer">
        {canResume && !running && (
          <div className="ds-chat__resume">
            <span>最后一条 user 消息还没有回复</span>
            <button type="button" onClick={() => void onSendExisting()}>
              继续发送
            </button>
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="ds-chat__pending">
            {pendingImages.map((image) => (
              <div className="ds-chat__thumb" key={image.id}>
                <img src={image.url} alt={image.name} title={image.name} />
                <button
                  type="button"
                  title="移除图片"
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((item) => item.id !== image.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="ds-chat__box">
          <textarea
            value={input}
            rows={1}
            placeholder={
              isMobile
                ? '给 DeepSeek 发消息…'
                : '给 DeepSeek 发消息…（Enter 发送，Shift + Enter 换行）'
            }
            spellCheck={false}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button
            type="button"
            className="ds-chat__attach"
            onClick={() => fileRef.current?.click()}
            title="添加图片（也可直接粘贴）"
            disabled={running}
          >
            <Icon name="image" size={15} />
          </button>
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
          {running ? (
            <button type="button" className="ds-chat__send is-stop" onClick={onStop} title="停止生成">
              <Icon name="stop" size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="ds-chat__send"
              onClick={() => void submit()}
              disabled={!input.trim() && pendingImages.length === 0}
              title="发送（Enter）"
            >
              <Icon name="play" size={13} />
            </button>
          )}
        </div>
        <div className="ds-chat__hint">Enter 发送 · Shift + Enter 换行 · 消息自动拼进上下文</div>
      </div>
    </section>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`ds-chat-msg ${isUser ? 'is-user' : 'is-assistant'} role-${message.role}`}>
      <div className="ds-chat-bubble">
        {message.images && message.images.length > 0 && (
          <div className="ds-chat-images">
            {message.images.map((image) =>
              image.url ? (
                <img key={image.id} src={image.url} alt={image.name} title={image.name} />
              ) : (
                <span key={image.id} className="ds-chat-image-missing">
                  图片已移除
                </span>
              ),
            )}
          </div>
        )}

        {message.reasoning_content && (
          <details className="ds-chat-reason">
            <summary>思考过程</summary>
            <div className="ds-chat-reason__body">{message.reasoning_content}</div>
          </details>
        )}

        {message.content &&
          (isUser || message.role === 'tool' ? (
            <div className="ds-chat-text">{message.content}</div>
          ) : (
            <MarkdownView text={message.content} />
          ))}

        {message.tool_calls && message.tool_calls.length > 0 && (
          <details className="ds-chat-tools">
            <summary>tool_calls · {message.tool_calls.length}</summary>
            <pre>{JSON.stringify(message.tool_calls, null, 2)}</pre>
          </details>
        )}

        {message.prefix && <span className="ds-chat-badge">prefix</span>}
      </div>
    </div>
  );
}
