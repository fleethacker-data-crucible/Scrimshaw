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
    cues.push({ start, end, text: stripCueTags(body.join('\n')).trim() });
  }
  return cues;
}

// WebVTT cue markup (<v Speaker>, <i>, <b>, <c.class>, timestamps) is not spoken text.
// A closed tag is the span from '<' through the next '>'. An unclosed <script, <style,
// or <iframe has no '>' and is dropped. Any other bare '<' (as in "x < y") stays.
const UNCLOSED_DANGEROUS = ['script', 'style', 'iframe'];

function stripCueTags(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') { out += text[i++]; continue; }
    const gt = text.indexOf('>', i + 1);
    if (gt > i + 1) { i = gt + 1; continue; }
    const head = text.slice(i + 1, i + 7).toLowerCase();
    const bad = gt < 0 ? UNCLOSED_DANGEROUS.find((name) => head.startsWith(name)) : undefined;
    if (bad) { i += 1 + bad.length; continue; }
    out += text[i++];
  }
  return out;
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
