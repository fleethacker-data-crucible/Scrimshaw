// Media handed over by other Fleet apps (Fleet integrations, issue 14, "Flows"): plain files, checked by their
// bytes rather than their names, so a wrong or renamed file is refused with a reason instead of breaking a slide.
//   Capstan:     MP4 or WebM video, WebVTT captions, chapters as a WebVTT track or a "0:00 Title" list
//   SnapShackle: NAME.png and its NAME.png.meta.json sidecar ({tags, note, ocr})
//   TalkForge:   WAV narration
// Pure functions on bytes: no DOM, no network. The editor wires them to a file picker.
import { baseStyle, newObject, newScene, newSlide, uid } from '../model/factory.ts';
import type { Asset, Course, ID, Scene, Slide } from '../model/types.ts';
import { parseVtt } from '../render/vtt.ts';

import { MAX_MEDIA_BYTES } from '../editor/assets.ts';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_META_BYTES = 256 * 1024;

export interface ImportFile { name: string; bytes: Uint8Array }
export interface Chapter { time: number; title: string }

export type MediaItem =
  | { kind: 'video'; name: string; mime: 'video/mp4' | 'video/webm'; bytes: Uint8Array }
  | { kind: 'captions'; name: string; text: string; cues: number }
  | { kind: 'chapters'; name: string; chapters: Chapter[] }
  | { kind: 'image'; name: string; bytes: Uint8Array; width: number; height: number }
  | { kind: 'image-meta'; name: string; tags: string[]; note: string; ocr: string }
  | { kind: 'audio'; name: string; bytes: Uint8Array; seconds: number; sampleRate: number; channels: number; bits: number };

export type Inspected = { ok: true; item: MediaItem } | { ok: false; reason: string };
const no = (reason: string): Inspected => ({ ok: false, reason });

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
const ext = (name: string) => (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();

// ---------- binary formats ----------

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);

export function inspectMp4(name: string, b: Uint8Array): Inspected {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return no(`“${name}” is not an MP4 file (no ftyp header).`);
  const size = u32be(b, 0);
  if (size < 16 || size > b.length) return no(`“${name}” has a damaged MP4 header.`);
  const brands = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(b, i, 4));
  if (!brands.some((x) => MP4_BRANDS.has(x))) return no(`“${name}” is an ISO media file (${brands[0].trim()}) but not a web-playable MP4.`);
  return { ok: true, item: { kind: 'video', name, mime: 'video/mp4', bytes: b } };
}

export function inspectWebm(name: string, b: Uint8Array): Inspected {
  if (b.length < 16 || b[0] !== 0x1a || b[1] !== 0x45 || b[2] !== 0xdf || b[3] !== 0xa3) return no(`“${name}” is not a WebM file (no EBML header).`);
  const head = ascii(b, 0, Math.min(b.length, 64));
  if (head.includes('matroska')) return no(`“${name}” is Matroska (.mkv), not WebM. Browsers play WebM or MP4.`);
  if (!head.includes('webm')) return no(`“${name}” has an EBML header but no WebM doc type.`);
  return { ok: true, item: { kind: 'video', name, mime: 'video/webm', bytes: b } };
}

export function inspectPng(name: string, b: Uint8Array): Inspected {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v)) return no(`“${name}” is not a PNG image.`);
  if (ascii(b, 12, 4) !== 'IHDR' || u32be(b, 8) !== 13) return no(`“${name}” has a damaged PNG header.`);
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (width < 1 || height < 1 || width > 16384 || height > 16384) return no(`“${name}” has an unusable image size (${width} × ${height}).`);
  return { ok: true, item: { kind: 'image', name, bytes: b, width, height } };
}

export function inspectWav(name: string, b: Uint8Array): Inspected {
  if (b.length < 44 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return no(`“${name}” is not a WAV file.`);
  let fmt: { tag: number; channels: number; rate: number; byteRate: number; bits: number } | null = null;
  let dataBytes = -1;
  for (let at = 12; at + 8 <= b.length;) {
    const id = ascii(b, at, 4);
    const len = u32le(b, at + 4);
    if (id === 'fmt ' && len >= 16 && at + 8 + 16 <= b.length) {
      fmt = { tag: u16le(b, at + 8), channels: u16le(b, at + 10), rate: u32le(b, at + 12), byteRate: u32le(b, at + 16), bits: u16le(b, at + 22) };
    } else if (id === 'data') {
      // A streamed WAV can declare more (or 0xFFFFFFFF) than it holds: trust what is there.
      dataBytes = Math.min(len, b.length - (at + 8));
      break;
    }
    at += 8 + len + (len & 1);
  }
  if (!fmt) return no(`“${name}” has no fmt chunk.`);
  if (![1, 3, 0xfffe].includes(fmt.tag)) return no(`“${name}” is compressed WAV (format ${fmt.tag}). Use PCM WAV.`);
  if (fmt.channels < 1 || fmt.channels > 8 || fmt.rate < 8000 || fmt.rate > 192000 || fmt.byteRate < 1 || ![8, 16, 24, 32].includes(fmt.bits)) return no(`“${name}” has an unusable audio format.`);
  if (dataBytes <= 0) return no(`“${name}” has no audio data.`);
  return { ok: true, item: { kind: 'audio', name, bytes: b, seconds: Math.round((dataBytes / fmt.byteRate) * 1000) / 1000, sampleRate: fmt.rate, channels: fmt.channels, bits: fmt.bits } };
}

// ---------- text formats ----------

/** Capstan's YouTube-style list: one "0:00 Title" or "1:02:03 Title" per line, times strictly increasing. */
export function parseChapterList(text: string): Chapter[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: Chapter[] = [];
  for (const line of lines) {
    const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$/.exec(line);
    if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) return null;
    const time = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (out.length && time <= out[out.length - 1].time) return null;
    out.push({ time, title: m[4].slice(0, 120) });
  }
  return out.length ? out : null;
}

export function inspectText(name: string, b: Uint8Array): Inspected {
  if (b.length > MAX_TEXT_BYTES) return no(`“${name}” is larger than 2 MB.`);
  const text = decode(b);
  const e = ext(name);
  if (e === 'vtt') {
    if (!/^WEBVTT/.test(text)) return no(`“${name}” does not start with WEBVTT, so it is not a valid WebVTT file.`);
    const cues = parseVtt(text);
    if (cues.length === 0) return no(`“${name}” is WebVTT but has no cues.`);
    // Capstan's chapters track is named "... chapters.vtt"; each cue is one chapter title.
    if (/chapters?/i.test(name)) {
      return { ok: true, item: { kind: 'chapters', name, chapters: cues.map((c) => ({ time: c.start, title: c.text.replace(/\s+/g, ' ').slice(0, 120) })).filter((c) => c.title) } };
    }
    return { ok: true, item: { kind: 'captions', name, text, cues: cues.length } };
  }
  const chapters = parseChapterList(text);
  if (!chapters) return no(`“${name}” is not a chapters list. Expected one “0:00 Title” per line with increasing times.`);
  return { ok: true, item: { kind: 'chapters', name, chapters } };
}

/** SnapShackle's sidecar: {tags, note, ocr}. Unknown fields are ignored; wrong types are refused. */
export function inspectMeta(name: string, b: Uint8Array): Inspected {
  if (b.length > MAX_META_BYTES) return no(`“${name}” is larger than 256 KB.`);
  let j: unknown;
  try { j = JSON.parse(decode(b)); } catch { return no(`“${name}” is not valid JSON.`); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return no(`“${name}” is not a SnapShackle metadata object.`);
  const o = j as Record<string, unknown>;
  if (o.tags !== undefined && (!Array.isArray(o.tags) || o.tags.some((t) => typeof t !== 'string'))) return no(`“${name}”: tags must be a list of text.`);
  if ((o.note !== undefined && typeof o.note !== 'string') || (o.ocr !== undefined && typeof o.ocr !== 'string')) return no(`“${name}”: note and ocr must be text.`);
  if (o.tags === undefined && o.note === undefined && o.ocr === undefined) return no(`“${name}” has none of tags, note or ocr.`);
  return { ok: true, item: { kind: 'image-meta', name, tags: ((o.tags as string[]) ?? []).slice(0, 50), note: ((o.note as string) ?? '').slice(0, 2000), ocr: ((o.ocr as string) ?? '').slice(0, 20000) } };
}

/** Looks at the bytes (and the extension only to choose which checks to run). */
export function inspectFile(f: ImportFile): Inspected {
  const { name, bytes } = f;
  if (bytes.length === 0) return no(`“${name}” is empty.`);
  if (bytes.length > MAX_MEDIA_BYTES) return no(`“${name}” is ${(bytes.length / 1048576).toFixed(1)} MB. The limit is ${MAX_MEDIA_BYTES / 1048576} MB per file.`);
  const e = ext(name);
  if (/\.png\.meta\.json$/i.test(name)) return inspectMeta(name, bytes);
  switch (e) {
    case 'mp4': case 'm4v': return inspectMp4(name, bytes);
    case 'webm': return inspectWebm(name, bytes);
    case 'png': return inspectPng(name, bytes);
    case 'wav': return inspectWav(name, bytes);
    case 'vtt': case 'txt': return inspectText(name, bytes);
    default: return no(`“${name}” is not a type Scrimshaw imports from the Fleet (MP4, WebM, .vtt, chapters .txt, PNG with .meta.json, WAV).`);
  }
}

// ---------- planning: pair sidecars with their media ----------

export interface VideoImport { video: Extract<MediaItem, { kind: 'video' }>; captions: Extract<MediaItem, { kind: 'captions' }> | null; chapters: Extract<MediaItem, { kind: 'chapters' }> | null }
export interface ImageImport { image: Extract<MediaItem, { kind: 'image' }>; meta: Extract<MediaItem, { kind: 'image-meta' }> | null }
export interface ImportPlan { videos: VideoImport[]; images: ImageImport[]; audio: Extract<MediaItem, { kind: 'audio' }>[]; rejected: { name: string; reason: string }[]; warnings: string[] }

const stem = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[\s._-]*(captions?|subtitles?|chapters?)$/i, '').trim().toLowerCase();

export function planImport(files: ImportFile[]): ImportPlan {
  const plan: ImportPlan = { videos: [], images: [], audio: [], rejected: [], warnings: [] };
  const captions: Extract<MediaItem, { kind: 'captions' }>[] = [];
  const chapters: Extract<MediaItem, { kind: 'chapters' }>[] = [];
  const metas = new Map<string, Extract<MediaItem, { kind: 'image-meta' }>>();
  for (const f of files) {
    const r = inspectFile(f);
    if (!r.ok) { plan.rejected.push({ name: f.name, reason: r.reason }); continue; }
    const it = r.item;
    if (it.kind === 'video') plan.videos.push({ video: it, captions: null, chapters: null });
    else if (it.kind === 'image') plan.images.push({ image: it, meta: null });
    else if (it.kind === 'audio') plan.audio.push(it);
    else if (it.kind === 'captions') captions.push(it);
    else if (it.kind === 'chapters') chapters.push(it);
    else metas.set(it.name.replace(/\.meta\.json$/i, '').toLowerCase(), it);
  }
  const attach = <T extends { name: string }>(list: T[], what: string, set: (v: VideoImport, x: T) => void, has: (v: VideoImport) => boolean) => {
    for (const x of list) {
      const exact = plan.videos.find((v) => !has(v) && stem(v.video.name) === stem(x.name));
      // One video and one sidecar of a kind: they belong together even if the names differ.
      const only = !exact && plan.videos.length === 1 && !has(plan.videos[0]) ? plan.videos[0] : undefined;
      const target = exact ?? only;
      if (!target) { plan.warnings.push(`${what} “${x.name}” has no matching video and was skipped.`); continue; }
      if (only) plan.warnings.push(`${what} “${x.name}” was attached to “${only.video.name}” because it is the only video.`);
      set(target, x);
    }
  };
  attach(captions, 'Captions', (v, x) => { v.captions = x; }, (v) => !!v.captions);
  attach(chapters, 'Chapters', (v, x) => { v.chapters = x; }, (v) => !!v.chapters);
  for (const im of plan.images) {
    const m = metas.get(im.image.name.toLowerCase());
    if (m) { im.meta = m; metas.delete(im.image.name.toLowerCase()); }
  }
  for (const m of metas.values()) plan.warnings.push(`“${m.name}” has no matching PNG and was skipped.`);
  return plan;
}

// ---------- applying a plan to a course ----------

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
const textUrl = (text: string, mime: string) => bytesToDataUrl(new TextEncoder().encode(text), mime);
const clock = (t: number) => { const h = Math.floor(t / 3600); const m = Math.floor(t / 60) % 60; const s = Math.floor(t % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const label = (name: string) => name.replace(/\.[^.]+$/, '').replace(/\.png$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 60) || 'Imported media';

/** Builds one scene of slides for the plan. Pure: pass a course copy (or use inside edit()). */
export function applyImport(c: Course, plan: ImportPlan): Scene | null {
  const added: Record<ID, Asset> = {};
  const addAsset = (name: string, mime: string, data: string): ID => { const id = uid('a'); added[id] = { id, name, mime, data }; return id; };
  const slides: Slide[] = [];
  for (const v of plan.videos) {
    const s = newSlide(label(v.video.name));
    const src = `asset:${addAsset(v.video.name, v.video.mime, bytesToDataUrl(v.video.bytes, v.video.mime))}`;
    const captions = v.captions ? `asset:${addAsset(v.captions.name, 'text/vtt', textUrl(v.captions.text, 'text/vtt'))}` : '';
    s.layers[0].objects.push(newObject('video', { name: label(v.video.name), x: 60, y: 30, w: 840, h: 472, src, captions, alt: label(v.video.name) }));
    if (v.chapters) s.notes = `Chapters\n${v.chapters.chapters.map((ch) => `${clock(ch.time)} ${ch.title}`).join('\n')}`;
    slides.push(s);
  }
  for (const im of plan.images) {
    const s = newSlide(label(im.image.name));
    const k = Math.min(1, 840 / im.image.width, 440 / im.image.height);
    const w = Math.round(im.image.width * k);
    const h = Math.round(im.image.height * k);
    const alt = im.meta?.note.trim() ?? '';
    s.layers[0].objects.push(newObject('image', {
      name: label(im.image.name), x: Math.round((960 - w) / 2), y: 60 + Math.round((440 - h) / 2), w, h, alt,
      src: `asset:${addAsset(im.image.name, 'image/png', bytesToDataUrl(im.image.bytes, 'image/png'))}`,
    }));
    // A screenshot's note is the author's description; otherwise the author must write alt text (publish check flags it).
    if (im.meta?.ocr) s.notes = `Text in the screenshot: ${im.meta.ocr.slice(0, 500)}`;
    if (im.meta?.tags.length) s.notes = `${s.notes ? `${s.notes}\n` : ''}Tags: ${im.meta.tags.join(', ')}`;
    slides.push(s);
  }
  for (const a of plan.audio) {
    const s = newSlide(label(a.name));
    s.duration = Math.max(1, Math.ceil(a.seconds));
    s.layers[0].objects.push(newObject('text', { name: 'Title', x: 60, y: 40, w: 840, h: 80, text: label(a.name), style: baseStyle({ fontSize: 30, fontWeight: 600 }) }));
    s.layers[0].objects.push(newObject('audio', { name: label(a.name), src: `asset:${addAsset(a.name, 'audio/wav', bytesToDataUrl(a.bytes, 'audio/wav'))}`, controls: true, autoplay: true, alt: label(a.name) }));
    slides.push(s);
  }
  if (slides.length === 0) return null;
  c.assets = { ...c.assets, ...added };
  const scene = newScene('Imported media', slides);
  c.scenes.push(scene);
  return scene;
}
