// Lightweight inline formatting for slide text (pure parser; rendering is in inline.tsx):
//   **bold**  *italic*  __underline__  ~~strike~~  [label](https://example.com)
//   lines starting with "- " or "• " become bullets
// Links accept http(s) and mailto only.
export type Run =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'u' | 's'; c: Run[] }
  | { t: 'a'; href: string; c: Run[] };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Parses one line into runs. Unmatched markers stay as literal text. */
export function parseInline(src: string): Run[] {
  const out: Run[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  const pairs: [string, 'b' | 'i' | 'u' | 's'][] = [['**', 'b'], ['__', 'u'], ['~~', 's'], ['*', 'i']];
  outer: while (i < src.length) {
    if (src[i] === '\\' && i + 1 < src.length && '*_~[]\\'.includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (src[i] === '[') {
      const close = src.indexOf('](', i + 1);
      const end = close >= 0 ? src.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        const label = src.slice(i + 1, close);
        const href = src.slice(close + 2, end).trim();
        if (SAFE_URL.test(href) && label) {
          flush();
          out.push({ t: 'a', href, c: parseInline(label) });
          i = end + 1;
          continue;
        }
      }
    }
    for (const [mark, t] of pairs) {
      if (src.startsWith(mark, i)) {
        const close = src.indexOf(mark, i + mark.length);
        const inner = close > 0 ? src.slice(i + mark.length, close) : '';
        // Require non-space just inside the markers, as Markdown does, so "2 * 3 * 4" stays literal.
        if (close > i + mark.length && !/^\s|\s$/.test(inner)) {
          flush();
          out.push({ t, c: parseInline(inner) });
          i = close + mark.length;
          continue outer;
        }
      }
    }
    buf += src[i++];
  }
  flush();
  return out;
}

export function hasMarkup(text: string): boolean {
  return /\*|__|~~|\[[^\]]+\]\(|^\s*[-•] /m.test(text);
}


/** Wraps (or unwraps) the selected range in a formatting marker. Returns the new text and selection. */
export function toggleMarker(text: string, start: number, end: number, marker: '**' | '*' | '__'): { text: string; start: number; end: number } {
  const m = marker.length;
  const before = text.slice(Math.max(0, start - m), start);
  const after = text.slice(end, end + m);
  if (before === marker && after === marker && !(marker === '*' && (text[start - m - 1] === '*' || text[end + m] === '*'))) {
    return { text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m), start: start - m, end: end - m };
  }
  return { text: text.slice(0, start) + marker + text.slice(start, end) + marker + text.slice(end), start: start + m, end: end + m };
}

export const MARKER_KEYS: Record<string, '**' | '*' | '__'> = { b: '**', i: '*', u: '__' };
