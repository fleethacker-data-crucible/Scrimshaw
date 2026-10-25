// Minimal WebVTT support: parsing cues for audio captions (video uses the browser's own <track>).

export interface Cue { start: number; end: number; text: string }

function time(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function parseVtt(text: string): Cue[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (!/^WEBVTT/.test(lines[0] ?? '')) return [];
  const cues: Cue[] = [];
  for (let i = 1; i < lines.length; i++) {
    const arrow = lines[i].indexOf('-->');
    if (arrow < 0) continue;
    const start = time(lines[i].slice(0, arrow));
    const end = time(lines[i].slice(arrow + 3).trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null) continue;
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1].trim() !== '') body.push(lines[++i]);
    // Strip cue markup such as <v Speaker>, <i>, <b>.
    cues.push({ start, end, text: body.join('\n').replace(/<[^>]+>/g, '').trim() });
  }
  return cues;
}

export function cueAt(cues: Cue[], t: number): string {
  return cues.filter((c) => t >= c.start && t < c.end).map((c) => c.text).join('\n');
}

/** Decodes a data:text/vtt URL (base64 or percent-encoded). Returns null for anything else. */
export function vttFromDataUrl(url: string): string | null {
  const m = /^data:text\/vtt(?:;charset=[\w-]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    if (!m[1]) return decodeURIComponent(m[2]);
    const bin = atob(m[2]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function vttToDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:text/vtt;base64,${btoa(bin)}`;
}
