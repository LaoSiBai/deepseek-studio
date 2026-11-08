import { memo, useDeferredValue, useMemo, type ReactNode } from 'react';
import { CopyButton } from './ui';

type Block =
  | { type: 'code'; lang: string; code: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' };

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_LINE = /^[\s|:-]+$/;

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    HR.test(line) ||
    line.trimStart().startsWith('|')
  );
}

function isTableStart(header: string, separator: string): boolean {
  if (!header.includes('|')) return false;
  if (!TABLE_LINE.test(separator) || !separator.includes('-')) return false;
  return true;
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const lang = line.trim().slice(3).trim();
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lang, code: buffer.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        buffer.push(lines[index].replace(QUOTE, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: buffer.join('\n') });
      continue;
    }

    if (index + 1 < lines.length && isTableStart(lines[index], lines[index + 1])) {
      const header = splitRow(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const listStart = LIST_ITEM.exec(line);
    if (listStart) {
      const ordered = /^\d/.test(listStart[1]);
      const start = ordered ? Number.parseInt(listStart[1], 10) : 1;
      const items: string[] = [];
      while (index < lines.length) {
        const item = LIST_ITEM.exec(lines[index]);
        if (!item) break;
        items.push(item[2]);
        index += 1;
        while (
          index < lines.length &&
          /^\s{2,}\S/.test(lines[index]) &&
          !LIST_ITEM.test(lines[index]) &&
          !startsBlock(lines[index].trimStart())
        ) {
          items[items.length - 1] += `\n${lines[index].trim()}`;
          index += 1;
        }
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    const buffer = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      buffer.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: buffer.join('\n') });
  }

  return blocks;
}

const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>"'，。；：！？、）】]+)/g;

function safeUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url);
}

function renderInline(text: string, depth = 0): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let count = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${depth}-${count++}`;

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), depth + 1)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), depth + 1)}</em>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link && safeUrl(link[2])) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {renderInline(link[1], depth + 1)}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer noopener">
          {token}
        </a>,
      );
    }
    last = start + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderLines(text: string, depth = 0): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`br-${depth}-${index}`} />);
    nodes.push(...renderInline(line, depth + index));
  });
  return nodes;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'code':
      return (
        <div className="ds-codeblock" key={key}>
          <div className="ds-codeblock__head">
            <span>{block.lang || 'code'}</span>
            <span className="ds-spacer" />
            <CopyButton text={block.code} label="复制代码" />
          </div>
          <pre>
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case 'heading': {
      const content = renderInline(block.text, key);
      switch (block.level) {
        case 1:
          return <h1 key={key}>{content}</h1>;
        case 2:
          return <h2 key={key}>{content}</h2>;
        case 3:
          return <h3 key={key}>{content}</h3>;
        case 4:
          return <h4 key={key}>{content}</h4>;
        case 5:
          return <h5 key={key}>{content}</h5>;
        default:
          return <h6 key={key}>{content}</h6>;
      }
    }
    case 'paragraph':
      return <p key={key}>{renderLines(block.text, key)}</p>;
    case 'quote':
      return <blockquote key={key}>{renderLines(block.text, key)}</blockquote>;
    case 'hr':
      return <hr key={key} />;
    case 'list': {
      const items = block.items.map((item, index) => {
        const task = /^\[([ xX])\]\s+/.exec(item);
        if (task) {
          return (
            <li key={index} className="ds-md__task">
              <span className={`ds-md__check ${task[1].toLowerCase() === 'x' ? 'is-on' : ''}`} />
              <span>{renderInline(item.slice(task[0].length), index)}</span>
            </li>
          );
        }
        return <li key={index}>{renderLines(item, index)}</li>;
      });
      return block.ordered ? (
        <ol key={key} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case 'table':
      return (
        <div className="ds-md__tablewrap" key={key}>
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index}>{renderInline(cell, index)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell, cellIndex)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  // 流式高频更新时让解析让位给输入等交互，内容会稍微滞后一点点
  const deferred = useDeferredValue(text);
  const blocks = useMemo(() => parseBlocks(deferred), [deferred]);
  return <div className="ds-md">{blocks.map((block, index) => renderBlock(block, index))}</div>;
});
