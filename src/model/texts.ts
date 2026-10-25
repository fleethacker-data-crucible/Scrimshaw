// Every learner-facing string in a course, addressable by a stable key. Used by find and
// replace and by translation export/import (CSV).
import { allSlides } from './query.ts';
import type { Course, ID } from './types.ts';

export interface TextEntry {
  key: string;
  slideId: ID | null;
  objectId: ID | null;
  /** Human-readable place, e.g. "3. Results › Score". */
  where: string;
  field: 'course title' | 'slide title' | 'text' | 'alt text' | 'state text' | 'accepted answer';
  text: string;
}

export function collectTexts(course: Course): TextEntry[] {
  const out: TextEntry[] = [{ key: 'course:title', slideId: null, objectId: null, where: 'Course', field: 'course title', text: course.title }];
  allSlides(course).forEach((sl, i) => {
    const at = `${i + 1}. ${sl.title}`;
    out.push({ key: `slide:${sl.id}:title`, slideId: sl.id, objectId: null, where: at, field: 'slide title', text: sl.title });
    for (const l of sl.layers) for (const o of l.objects) {
      const where = `${at} › ${l.base ? '' : `${l.name} › `}${o.name}`;
      if (o.text) out.push({ key: `obj:${o.id}:text`, slideId: sl.id, objectId: o.id, where, field: 'text', text: o.text });
      if (o.alt) out.push({ key: `obj:${o.id}:alt`, slideId: sl.id, objectId: o.id, where, field: 'alt text', text: o.alt });
      for (const st of o.states) if (st.text) out.push({ key: `state:${o.id}:${st.id}`, slideId: sl.id, objectId: o.id, where: `${where} (${st.name})`, field: 'state text', text: st.text });
    }
    sl.question?.accepted.forEach((a, j) => { if (a.trim()) out.push({ key: `answer:${sl.id}:${j}`, slideId: sl.id, objectId: null, where: at, field: 'accepted answer', text: a }); });
  });
  return out;
}

/** Writes new text for the given keys into a (draft) course. Returns how many were applied. */
export function applyTexts(course: Course, values: Map<string, string>): number {
  let n = 0;
  const put = (key: string, fn: (v: string) => void) => { const v = values.get(key); if (v !== undefined) { fn(v); n++; } };
  put('course:title', (v) => { course.title = v; });
  for (const sl of allSlides(course)) {
    put(`slide:${sl.id}:title`, (v) => { sl.title = v; });
    for (const l of sl.layers) for (const o of l.objects) {
      put(`obj:${o.id}:text`, (v) => { o.text = v; });
      put(`obj:${o.id}:alt`, (v) => { o.alt = v; });
      for (const st of o.states) put(`state:${o.id}:${st.id}`, (v) => { st.text = v; });
    }
    if (sl.question) sl.question.accepted = sl.question.accepted.map((a, j) => values.get(`answer:${sl.id}:${j}`) ?? a);
    if (sl.question) for (let j = 0; j < sl.question.accepted.length; j++) if (values.has(`answer:${sl.id}:${j}`)) n++;
  }
  return n;
}

// ---------- find and replace ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findTexts(course: Course, needle: string, matchCase: boolean): TextEntry[] {
  if (!needle) return [];
  const re = new RegExp(escapeRe(needle), matchCase ? '' : 'i');
  return collectTexts(course).filter((e) => re.test(e.text));
}

export function replaceAll(course: Course, needle: string, replacement: string, matchCase: boolean): number {
  if (!needle) return 0;
  const re = new RegExp(escapeRe(needle), matchCase ? 'g' : 'gi');
  const values = new Map<string, string>();
  let count = 0;
  for (const e of collectTexts(course)) {
    const m = e.text.match(re);
    if (!m) continue;
    count += m.length;
    values.set(e.key, e.text.replace(re, () => replacement));
  }
  applyTexts(course, values);
  return count;
}

// ---------- CSV (RFC 4180) ----------

const cell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function textsToCsv(course: Course): string {
  const rows = [['key', 'where', 'field', 'source', 'translation']];
  for (const e of collectTexts(course)) rows.push([e.key, e.where, e.field, e.text, '']);
  // BOM so Excel opens UTF-8 correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Reads a translated CSV: rows whose "translation" cell is filled replace the matching text. */
export function csvToTexts(csv: string): Map<string, string> {
  const rows = parseCsv(csv);
  const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const k = head.indexOf('key');
  const t = head.indexOf('translation');
  if (k < 0 || t < 0) throw new Error('The CSV needs "key" and "translation" columns (export one from Scrimshaw first).');
  const out = new Map<string, string>();
  for (const r of rows.slice(1)) if (r[k] && r[t] !== undefined && r[t] !== '') out.set(r[k], r[t]);
  return out;
}

// ---------- colour contrast (WCAG 2.1) ----------

export function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
