import {
  useEffect,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icons';

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  tone = 'default',
  size = 14,
  className = '',
}: {
  icon: IconName;
  label: string;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'accent';
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`ds-iconbtn ${active ? 'is-active' : ''} tone-${tone} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'subtle',
  icon,
  disabled,
  type = 'button',
  className = '',
  title,
}: {
  children?: ReactNode;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'subtle' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`ds-btn ds-btn--${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon && <Icon name={icon} size={13} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ds-kbd">{children}</kbd>;
}

export function Field({
  label,
  hint,
  children,
  wide = false,
  aside,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className={`ds-field ${wide ? 'is-wide' : ''}`}>
      <div className="ds-field__head">
        <span className="ds-field__label">
          {label}
          {hint && (
            <span className="ds-field__hint" title={hint}>
              ?
            </span>
          )}
        </span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono = false,
  type = 'text',
  onKeyDown,
  spellCheck = false,
  className = '',
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: 'text' | 'password' | 'url';
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  spellCheck?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <input
      className={`ds-input ${mono ? 'is-mono' : ''} ${className}`}
      value={value}
      type={type}
      title={title}
      placeholder={placeholder}
      spellCheck={spellCheck}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      className="ds-input ds-input--num"
      type="number"
      inputMode="decimal"
      value={value ?? ''}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next === '' ? undefined : next);
      }}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`ds-selectwrap ${className}`}>
      <select className="ds-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value || '__empty'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} />
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  mono = false,
  invalid = false,
  autoGrow = false,
  onKeyDown,
  onPaste,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  invalid?: boolean;
  autoGrow?: boolean;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
}) {
  return (
    <textarea
      className={`ds-textarea ${mono ? 'is-mono' : ''} ${invalid ? 'is-invalid' : ''} ${autoGrow ? 'is-autogrow' : ''} ${className}`}
      value={value}
      rows={rows}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}

/** 三态开关：未设置 → true → false 循环 */
export function TriState({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const state = value === 'true' ? 'true' : value === 'false' ? 'false' : 'unset';
  const next = state === 'unset' ? 'true' : state === 'true' ? 'false' : undefined;
  return (
    <button
      type="button"
      className={`ds-tristate is-${state}`}
      onClick={() => onChange(next)}
      title={state === 'unset' ? '当前不发送该字段，点击发送 true' : state === 'true' ? '当前 true，点击改为 false' : '当前 false，点击取消发送'}
    >
      <span className="ds-tristate__dot" />
      <span>{state === 'unset' ? '未发送' : state}</span>
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'error';
}) {
  return <span className={`ds-badge tone-${tone}`}>{children}</span>;
}

export function SectionTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="ds-section-title">
      <span>{children}</span>
      {aside}
    </div>
  );
}

export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? '已复制' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    />
  );
}

export interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

type ToastListener = (item: ToastItem) => void;
const listeners = new Set<ToastListener>();
let toastId = 0;
let lastToast = { message: '', at: 0 };

export function toast(message: string, tone: ToastItem['tone'] = 'info'): void {
  if (!message) return;
  const now = Date.now();
  if (message === lastToast.message && now - lastToast.at < 800) return;
  lastToast = { message, at: now };
  const item: ToastItem = { id: (toastId += 1), message, tone };
  listeners.forEach((listener) => listener(item));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: ToastListener = (item) => {
      setItems((prev) => [...prev.slice(-3), item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      }, 3200);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="ds-toasts">
      {items.map((item) => (
        <div key={item.id} className={`ds-toast tone-${item.tone}`}>
          {item.tone === 'error' ? <Icon name="alert" size={13} /> : item.tone === 'success' ? <Icon name="check" size={13} /> : <Icon name="terminal" size={13} />}
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
}
