import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newSlide } from '../src/model/factory.ts';
import { FAIRLEAD_LABEL } from '../src/ai/router.ts';
import {
  DEFAULT_VOICE, MAX_SPEECH_CHARS, SPEECH_PATH, TRANSCRIBE_PATH, VoiceError, narrationAssets, narrationText, narrationVtt,
  placeNarration, speak, speechPayload, transcribe, transcriptFromReply, wavSeconds,
} from '../src/ai/voice.ts';
import type { RouterSettings } from '../src/ai/router.ts';

const on = (over: Partial<RouterSettings> = {}): RouterSettings => ({ enabled: true, url: 'http://127.0.0.1:8776', model: 'auto', localOnly: true, ...over });

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function wav(dataBytes: number, rate = 8000): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const w = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  const u32 = (at: number, n: number) => { bytes[at] = n & 255; bytes[at + 1] = (n >> 8) & 255; bytes[at + 2] = (n >> 16) & 255; bytes[at + 3] = (n >> 24) & 255; };
  const u16 = (at: number, n: number) => { bytes[at] = n & 255; bytes[at + 1] = (n >> 8) & 255; };
  w(0, 'RIFF'); u32(4, 36 + dataBytes); w(8, 'WAVE');
  w(12, 'fmt '); u32(16, 16); u16(20, 1); u16(22, 1); u32(24, rate); u32(28, rate * 2); u16(32, 2); u16(34, 16);
  w(36, 'data'); u32(40, dataBytes);
  return bytes;
}

test('narration uses the notes, and otherwise the title and text', () => {
  const slide = newSlide('Lifting');
  slide.layers[0].objects.push({ kind: 'text', text: 'Bend the knees' } as never);
  assert.equal(narrationText(slide), 'Lifting\nBend the knees');
  slide.notes = 'Say this instead.';
  assert.equal(narrationText(slide), 'Say this instead.');
  slide.notes = 'x'.repeat(MAX_SPEECH_CHARS + 50);
  assert.equal(narrationText(slide).length, MAX_SPEECH_CHARS);
});

test('a speech request is TalkForge-shaped and a caption cue covers the words', () => {
  assert.deepEqual(speechPayload('Hello', 'en_US-libritts-high'), { input: 'Hello', voice: 'en_US-libritts-high', response_format: 'wav', speed: 1 });
  assert.equal(speechPayload('Hello', 'alloy voice!').voice, DEFAULT_VOICE);
  const vtt = narrationVtt('Bend the knees', 3);
  assert.match(vtt, /^WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nBend the knees\n$/);
  const bytes = wav(1600, 8000);
  assert.equal(wavSeconds(bytes), 0.1);
  assert.equal(wavSeconds(new Uint8Array([1, 2, 3])), null);
  const assets = narrationAssets('Bend the knees', bytes, 'audio/wav');
  assert.equal(assets.audio.mime, 'audio/wav');
  assert.equal(assets.captions.mime, 'text/vtt');
  assert.match(assets.audio.data, /^data:audio\/wav;base64,/);
});

test('narration replaces an existing Narration object', () => {
  const slide = newSlide('Lifting');
  const bytes = wav(160);
  const first = narrationAssets('One', bytes, 'audio/wav');
  placeNarration(slide, first.audio, first.captions);
  const second = narrationAssets('Two', bytes, 'audio/wav');
  placeNarration(slide, second.audio, second.captions);
  const narrations = slide.layers[0].objects.filter((o) => o.name === 'Narration');
  assert.equal(narrations.length, 1);
  assert.equal(narrations[0].src, `asset:${second.audio.id}`);
  assert.equal(narrations[0].captions, `asset:${second.captions.id}`);
  assert.equal(narrations[0].controls, true);
  assert.equal(narrations[0].autoplay, true);
});

test('speech goes to the local server with no key', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const body = wav(160);
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(asBuffer(body), { headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch;
  const audio = await speak('Hello crew', 'en_US-libritts-high', { settings: on(), viaProxy: true, key: 'fl-abcdefghijklmnopqrstuvwx', fetchImpl });
  assert.equal(seen[0].url, SPEECH_PATH);
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['X-Fairlead-Label'], undefined);
  assert.equal(headers['X-Fairlead-Privacy'], 'local');
  assert.match(String(seen[0].init.body), /"response_format":"wav"/);
  assert.equal(audio.mime, 'audio/wav');
  assert.equal(audio.bytes.length, body.length);
});

test('a direct call is loopback only and names Scrimshaw', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(asBuffer(wav(160)), { headers: { 'content-type': 'audio/mpeg' } });
  }) as typeof fetch;
  const audio = await speak('Hello', DEFAULT_VOICE, { settings: on({ localOnly: false }), key: 'fl-abcdefghijklmnopqrstuvwx', fetchImpl });
  assert.equal(seen[0].url, 'http://127.0.0.1:8776/v1/audio/speech');
  assert.equal(seen[0].headers['X-Fairlead-Label'], FAIRLEAD_LABEL);
  assert.equal(seen[0].headers.Authorization, 'Bearer fl-abcdefghijklmnopqrstuvwx');
  assert.equal(audio.mime, 'audio/mpeg');
  await assert.rejects(() => speak('Hello', DEFAULT_VOICE, { settings: on({ url: 'http://evil.example:8776' }), fetchImpl: (() => { throw new Error('no'); }) as typeof fetch }), (e: unknown) => (e as VoiceError).code === 'bad-address');
});

test('a recording becomes a transcript and a key in an error is hidden', async () => {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    assert.equal(String(url), TRANSCRIBE_PATH);
    assert.ok(init?.body instanceof FormData);
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return new Response(JSON.stringify({ text: '  Bend the knees.  ' }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const text = await transcribe(new Blob([asBuffer(wav(160))], { type: 'audio/wav' }), 'note.wav', { settings: on(), viaProxy: true, key: 'fl-abcdefghijklmnopqrstuvwx', fetchImpl });
  assert.equal(text, 'Bend the knees.');
  assert.equal(transcriptFromReply('plain words'), 'plain words');
  const refused = (async () => new Response(JSON.stringify({ error: { message: 'no fl-abcdefghijklmnopqrstuvwx' } }), { status: 401 })) as typeof fetch;
  await assert.rejects(() => transcribe(new Blob(['x']), 'a.wav', { settings: on(), viaProxy: true, fetchImpl: refused }), (e: unknown) => {
    const err = e as VoiceError;
    assert.equal(err.code, 'rejected');
    assert.equal(err.message.includes('fl-abcdefghijklmnopqrstuvwx'), false);
    return true;
  });
});

test('voice stays off until the author opts in, and the server script lists both audio routes', async () => {
  await assert.rejects(() => speak('Hello', DEFAULT_VOICE, { settings: on({ enabled: false }), fetchImpl: (() => { throw new Error('no'); }) as typeof fetch }), (e: unknown) => (e as VoiceError).code === 'disabled');
  const start = readFileSync(new URL('../Start.ps1', import.meta.url), 'utf8');
  const proxy = readFileSync(new URL('../FairleadProxy.ps1', import.meta.url), 'utf8');
  assert.ok(start.includes('/api/fairlead/v1/audio/speech'));
  assert.ok(start.includes('/api/fairlead/v1/audio/transcriptions'));
  assert.ok(proxy.includes("'/v1/audio/speech'"));
  assert.ok(proxy.includes("'/v1/audio/transcriptions'"));
  assert.equal(/[^\x00-\x7f]/.test(proxy), false);
  assert.equal(/[^\x00-\x7f]/.test(start), false);
});
