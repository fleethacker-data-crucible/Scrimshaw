// TalkForge narration and speech-in, through Fairlead (issue 14).
// The page calls Scrimshaw's server. The server adds the key. A typed key is only the fallback
// when this page is not served by Start.ps1. TalkForge refuses a browser Origin, so speech
// goes to Fairlead, which calls TalkForge from this computer.
import { newObject, uid } from '../model/factory.ts';
import type { Asset, Slide, SlideObject } from '../model/types.ts';
import { vttToDataUrl } from '../render/vtt.ts';
import { FAIRLEAD_LABEL, FAIRLEAD_URL, isLoopbackUrl, type RouterCall, type RouterSettings } from './router.ts';

export const SPEECH_PATH = '/api/fairlead/v1/audio/speech';
export const TRANSCRIBE_PATH = '/api/fairlead/v1/audio/transcriptions';
export const DEFAULT_VOICE = 'en_US-libritts-high';
export const MAX_SPEECH_CHARS = 4000;
export const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;

export class VoiceError extends Error {
  readonly code: 'disabled' | 'empty' | 'rejected' | 'bad-reply' | 'bad-address' | 'too-large';
  constructor(message: string, code: VoiceError['code']) { super(message); this.code = code; }
}

/** Notes when the author wrote them, otherwise the title and the text objects. */
export function narrationText(slide: Pick<Slide, 'title' | 'notes' | 'layers'>): string {
  const notes = slide.notes.replace(/\s+/g, ' ').trim();
  const source = notes || [slide.title, ...slide.layers.flatMap((l) => l.objects.filter((o) => o.kind === 'text' && o.text.trim()).map((o) => o.text))].join('\n');
  return source.replace(/[ \t]+\n/g, '\n').trim().slice(0, MAX_SPEECH_CHARS);
}

export function speechPayload(input: string, voice = DEFAULT_VOICE): { input: string; voice: string; response_format: 'wav'; speed: number } {
  const v = /^[\w.-]{1,80}$/.test(voice.trim()) ? voice.trim() : DEFAULT_VOICE;
  return { input: input.slice(0, MAX_SPEECH_CHARS), voice: v, response_format: 'wav', speed: 1 };
}

function stamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const whole = Math.floor(sec);
  const ms = Math.round((sec - whole) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(whole)}.${pad(ms, 3)}`;
}

/** One cue covering the spoken text, so the narration is not silent to a screen reader. */
export function narrationVtt(text: string, seconds: number): string {
  const end = Math.min(3600, Math.max(2, seconds));
  const line = text.replace(/\s+/g, ' ').trim();
  return `WEBVTT\n\n${stamp(0)} --> ${stamp(end)}\n${line}\n`;
}

/** Duration of a 16-bit PCM WAV, or null when the bytes are not one. */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const u32 = (at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let dataBytes = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = ascii(at, 4);
    const len = u32(at + 4);
    if (id === 'fmt ' && at + 24 <= bytes.length) {
      channels = u16(at + 10);
      rate = u32(at + 12);
      bits = u16(at + 22);
    } else if (id === 'data') {
      dataBytes = Math.min(len, bytes.length - (at + 8));
      break;
    }
    at += 8 + len + (len % 2);
  }
  const frame = channels * (bits / 8);
  if (!rate || !frame || !dataBytes) return null;
  return dataBytes / (rate * frame);
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export function narrationAssets(text: string, bytes: Uint8Array, mime: string): { audio: Asset; captions: Asset } {
  const seconds = wavSeconds(bytes) ?? Math.max(2, text.split(/\s+/).filter(Boolean).length / 2.5);
  return {
    audio: { id: uid('a'), name: 'narration.wav', mime, data: bytesToDataUrl(bytes, mime) },
    captions: { id: uid('a'), name: 'narration.vtt', mime: 'text/vtt', data: vttToDataUrl(narrationVtt(text, seconds)) },
  };
}

/** Replaces an existing Narration object, or adds one that plays when the slide opens. */
export function placeNarration(slide: Slide, audio: Asset, captions: Asset): SlideObject {
  const base = slide.layers[0];
  let obj = base?.objects.find((o) => o.name === 'Narration' && o.kind === 'audio');
  if (!obj) {
    obj = newObject('audio', { name: 'Narration', x: 880, y: 480, w: 48, h: 48, autoplay: true, controls: true });
    base?.objects.push(obj);
  }
  obj.src = `asset:${audio.id}`;
  obj.captions = `asset:${captions.id}`;
  obj.alt = 'Narration';
  obj.autoplay = true;
  obj.controls = true;
  return obj;
}

function safeDetail(body: string): string {
  return body.replace(/fl-[A-Za-z0-9]+/g, '[key]').replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function fail(res: Response): Promise<never> {
  let detail = '';
  try {
    const j = await res.clone().json() as { error?: unknown };
    if (typeof j.error === 'string') detail = safeDetail(j.error);
    else if (j.error && typeof j.error === 'object' && 'message' in j.error && typeof (j.error as { message?: unknown }).message === 'string') {
      detail = safeDetail((j.error as { message: string }).message);
    }
  } catch { /* status line */ }
  throw new VoiceError(detail || `The router answered with status ${res.status}.`, 'rejected');
}

function endpoint(call: RouterCall, path: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (call.viaProxy) {
    if (call.settings.localOnly) headers['X-Fairlead-Privacy'] = 'local';
    return { url: path, headers };
  }
  if (!isLoopbackUrl(call.settings.url)) throw new VoiceError('The router address must be on this computer (127.0.0.1 or localhost).', 'bad-address');
  headers['X-Fairlead-Label'] = FAIRLEAD_LABEL;
  if (call.settings.localOnly) headers['X-Fairlead-Privacy'] = 'local';
  if (call.key) headers.Authorization = `Bearer ${call.key}`;
  return { url: `${call.settings.url.replace(/\/+$/, '')}${path.replace('/api/fairlead', '')}`, headers };
}

export function assertVoiceOn(settings: RouterSettings): void {
  if (!settings.enabled) throw new VoiceError('Voice through the router is off. Turn it on in this dialog first.', 'disabled');
}

/** TalkForge narration for one slide. Returns WAV (or MPEG) bytes. */
export async function speak(input: string, voice: string, call: RouterCall): Promise<{ bytes: Uint8Array; mime: string }> {
  assertVoiceOn(call.settings);
  const text = input.trim();
  if (!text) throw new VoiceError('This slide has no notes and no text to read.', 'empty');
  const { url, headers } = endpoint(call, SPEECH_PATH);
  headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await (call.fetchImpl ?? fetch)(url, { method: 'POST', headers, body: JSON.stringify(speechPayload(text, voice)), signal: call.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new VoiceError('Could not reach the router for narration.', 'rejected');
  }
  if (!res.ok) await fail(res);
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mime !== 'audio/wav' && mime !== 'audio/mpeg' && mime !== 'audio/mp3') throw new VoiceError('The router did not return audio.', 'bad-reply');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 16) throw new VoiceError('The router returned empty audio.', 'bad-reply');
  return { bytes, mime: mime === 'audio/mp3' ? 'audio/mpeg' : mime };
}

export function transcriptFromReply(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    let json: unknown;
    try { json = JSON.parse(trimmed); } catch { throw new VoiceError('The transcript was not valid JSON.', 'bad-reply'); }
    const text = (json as { text?: unknown })?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
    throw new VoiceError('The transcript was empty.', 'bad-reply');
  }
  if (trimmed) return trimmed;
  throw new VoiceError('The transcript was empty.', 'bad-reply');
}

/** Speech in. The file is forwarded as multipart; the reply's text is the transcript. */
export async function transcribe(file: Blob, name: string, call: RouterCall): Promise<string> {
  assertVoiceOn(call.settings);
  if (file.size <= 0) throw new VoiceError('That recording is empty.', 'empty');
  if (file.size > MAX_TRANSCRIBE_BYTES) throw new VoiceError('That recording is larger than 8 MB.', 'too-large');
  const { url, headers } = endpoint(call, TRANSCRIBE_PATH);
  const form = new FormData();
  form.append('file', file, name || 'recording.wav');
  form.append('model', call.settings.model || 'auto');
  form.append('response_format', 'json');
  let res: Response;
  try {
    res = await (call.fetchImpl ?? fetch)(url, { method: 'POST', headers, body: form, signal: call.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new VoiceError('Could not reach the router for the transcript.', 'rejected');
  }
  if (!res.ok) await fail(res);
  return transcriptFromReply(await res.text());
}

export { FAIRLEAD_URL };
