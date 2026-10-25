// Lightweight inline formatting for slide text, rendered as React elements (never as HTML):
//   **bold**  *italic*  __underline__  ~~strike~~  [label](https://example.com)
//   lines starting with "- " or "• " become bullets
// Links accept http(s) and mailto only and open in a new tab.
import type { ReactNode } from 'react';
import { hasMarkup, parseInline, type Run } from './markup.ts';

function render(runs: Run[], key: string): ReactNode[] {
  return runs.map((r, i) => {
    const k = `${key}.${i}`;
    switch (r.t) {
      case 'text': return r.v;
      case 'b': return <strong key={k}>{render(r.c, k)}</strong>;
      case 'i': return <em key={k}>{render(r.c, k)}</em>;
      case 'u': return <u key={k}>{render(r.c, k)}</u>;
      case 's': return <s key={k}>{render(r.c, k)}</s>;
      case 'a': return (
        <a key={k} href={r.href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>{render(r.c, k)}</a>
      );
    }
  });
}

/** Renders text with inline formatting and bullet lines. Plain text comes back unchanged. */
export function RichText({ text }: { text: string }): ReactNode {
  if (!hasMarkup(text)) return text;
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const endList = (k: number) => {
    if (list.length) { blocks.push(<ul key={`ul${k}`} style={{ margin: 0, paddingLeft: '1.2em', listStyle: 'disc' }}>{list}</ul>); list = []; }
  };
  lines.forEach((line, n) => {
    const m = /^\s*[-•]\s+(.*)$/.exec(line);
    if (m) { list.push(<li key={n}>{render(parseInline(m[1]), `l${n}`)}</li>); return; }
    endList(n);
    blocks.push(<span key={n} style={{ display: 'block', minHeight: '1em' }}>{render(parseInline(line), `p${n}`)}</span>);
  });
  endList(lines.length);
  return blocks;
}
