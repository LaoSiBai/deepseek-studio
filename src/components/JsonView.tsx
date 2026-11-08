const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

export function highlightJson(text: string): string {
  const escaped = text.replace(/[&<>]/g, (char) => ESCAPES[char]);
  if (escaped.length > 240_000) return escaped;
  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'j-num';
      if (match.startsWith('"')) {
        cls = /:\s*$/.test(match) ? 'j-key' : 'j-str';
      } else if (match === 'true' || match === 'false') {
        cls = 'j-bool';
      } else if (match === 'null') {
        cls = 'j-null';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

export function JsonView({ text, className = '' }: { text: string; className?: string }) {
  return (
    <pre
      className={`ds-json ${className}`}
      dangerouslySetInnerHTML={{ __html: highlightJson(text) }}
    />
  );
}
