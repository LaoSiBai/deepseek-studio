import type { ReactNode } from 'react';

export type IconName =
  | 'play'
  | 'stop'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'check'
  | 'chevronDown'
  | 'chevronRight'
  | 'grip'
  | 'download'
  | 'upload'
  | 'refresh'
  | 'x'
  | 'key'
  | 'history'
  | 'layers'
  | 'alert'
  | 'terminal'
  | 'pencil'
  | 'more'
  | 'settings'
  | 'message'
  | 'code'
  | 'sparkle'
  | 'eye'
  | 'external'
  | 'arrowUp'
  | 'arrowDown'
  | 'clock'
  | 'fileJson'
  | 'wifi'
  | 'search'
  | 'image';

const ICONS: Record<IconName, ReactNode> = {
  play: <path d="m6 3 14 9-14 9V3z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  grip: (
    <>
      {[9, 15].map((x) =>
        [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="currentColor" stroke="none" />),
      )}
    </>
  ),
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
  upload: <path d="M12 21V9m0 0 4 4m-4-4-4 4M5 3h14" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 3h4v4" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 21h20L12 3Z" />
      <path d="M12 9v5M12 17.2v.3" />
    </>
  ),
  terminal: <path d="m4 17 6-6-6-6M12 19h8" />,
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h4M12 17h8" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  message: <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5H7l-4 3v-5.2A8.4 8.4 0 0 1 12.5 3h.5a8 8 0 0 1 8 8Z" />,
  code: <path d="m9 18-6-6 6-6M15 6l6 6-6 6" />,
  sparkle: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6.3 6.3 2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  external: <path d="M14 3h7v7M21 3l-9 9M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />,
  arrowUp: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  arrowDown: <path d="M12 5v14m0 0-6-6m6 6 6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  fileJson: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
      <path d="M14 2v6h6" />
      <path d="M9 13c-.6 0-.8.6-.8 1.4 0 .6-.4 1.1-1.2 1.1.8 0 1.2.5 1.2 1.1 0 .8.2 1.4.8 1.4M15 13c.6 0 .8.6.8 1.4 0 .6.4 1.1 1.2 1.1-.8 0-1.2.5-1.2 1.1 0 .8-.2 1.4-.8 1.4" />
    </>
  ),
  wifi: <path d="M2 8.8a16 16 0 0 1 20 0M5.5 12.5a11 11 0 0 1 13 0M9 16.2a6 6 0 0 1 6 0M12 20h.01" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5L5 21" />
    </>
  ),
};

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
