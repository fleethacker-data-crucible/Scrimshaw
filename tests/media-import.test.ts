import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyImport, inspectFile, parseChapterList, planImport, type ImportFile } from '../src/import/media.ts';
import { newCourse } from '../src/model/factory.ts';
import { normalizeCourse } from '../src/model/schema.ts';

// Tiny synthetic files: just enough header for the byte checks. No real recordings, screenshots or voices.
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };
const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);
const le16 = (n: number) => Uint8Array.of(n & 255, n >>> 8);

const mp4 = (brand = 'isom') => cat(be32(24), enc('ftyp'), enc(brand), be32(0), enc('isom'), enc('mp42'), be32(8), enc('free'));
const webm = (doctype = 'webm') => cat(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, doctype.length), enc(doctype), new Uint8Array(24));
const png = (w: number, h: number) => cat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), be32(13), enc('IHDR'), be32(w), be32(h), Uint8Array.of(8, 6, 0, 0, 0), be32(0), be32(0), enc('IEND'), be32(0));
function wav(seconds: number, rate = 22050, tag = 1) {
  const data = new Uint8Array(Math.round(seconds * rate * 2));
  return cat(enc('RIFF'), le32(36 + data.length), enc('WAVE'), enc('fmt '), le32(16), le16(tag), le16(1), le32(rate), le32(rate * 2), le16(2), le16(16), enc('data'), le32(data.length), data);
}
const f = (name: string, bytes: Uint8Array | string): ImportFile => ({ name, bytes: typeof bytes === 'string' ? enc(bytes) : bytes });
const VTT = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nWelcome.\n\n00:00:02.000 --> 00:00:04.000\nSecond cue.\n';
const CHAPTERS_VTT = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:30.000\nIntro\n\n2\n00:00:30.000 --> 00:01:00.000\nDemo\n';
const CHAPTERS_TXT = '0:00 Intro\n0:30 Demo\n1:02:03 Wrap up\n';
const reason = (x: ReturnType<typeof inspectFile>) => (x.ok ? 'accepted' : x.reason);

test('video: MP4 and WebM are recognised by their bytes, not their names', () => {
  assert.equal(inspectFile(f('a.mp4', mp4())).ok, true);
  assert.equal((inspectFile(f('a.mp4', mp4('mp42'))) as { item: { mime: string } }).item.mime, 'video/mp4');
  assert.equal((inspectFile(f('a.webm', webm())) as { item: { mime: string } }).item.mime, 'video/webm');
  assert.match(reason(inspectFile(f('a.mp4', enc('this is not video at all')))), /not an MP4/);
  assert.match(reason(inspectFile(f('a.mp4', cat(be32(20), enc('ftyp'), enc('qt  '), be32(0), enc('qt  '), be32(8), enc('free'))))), /not a web-playable MP4/);
  assert.match(reason(inspectFile(f('a.webm', webm('matroska')))), /Matroska/);
  assert.equal(inspectFile(f('a.webm', mp4())).ok, false);
});

test('WebVTT captions and the two chapter formats Capstan writes', () => {
  const cap = inspectFile(f('Lesson 1.vtt', VTT));
  assert.ok(cap.ok && cap.item.kind === 'captions' && cap.item.cues === 2);
  const ch = inspectFile(f('Lesson 1 chapters.vtt', CHAPTERS_VTT));
  assert.ok(ch.ok && ch.item.kind === 'chapters');
  assert.deepEqual(ch.ok && ch.item.kind === 'chapters' ? ch.item.chapters : null, [{ time: 0, title: 'Intro' }, { time: 30, title: 'Demo' }]);
  assert.deepEqual(parseChapterList(CHAPTERS_TXT), [{ time: 0, title: 'Intro' }, { time: 30, title: 'Demo' }, { time: 3723, title: 'Wrap up' }]);
  assert.equal(parseChapterList('0:30 B\n0:10 A\n'), null);
  assert.equal(parseChapterList('hello\n'), null);
  assert.equal(inspectFile(f('x.vtt', 'not a track')).ok, false);
  assert.equal(inspectFile(f('x.vtt', 'WEBVTT\n\nnothing here\n')).ok, false);
  assert.equal(inspectFile(f('Lesson 1 chapters.txt', 'just prose')).ok, false);
});

test('SnapShackle PNG and sidecar, TalkForge WAV', () => {
  const p = inspectFile(f('Shot.png', png(1280, 720)));
  assert.ok(p.ok && p.item.kind === 'image' && p.item.width === 1280 && p.item.height === 720);
  assert.equal(inspectFile(f('Shot.png', png(0, 10))).ok, false);
  assert.equal(inspectFile(f('Shot.png', enc('GIF89a'))).ok, false);
  const m = inspectFile(f('Shot.png.meta.json', JSON.stringify({ tags: ['a'], note: 'Settings page', ocr: 'Save' })));
  assert.ok(m.ok && m.item.kind === 'image-meta' && m.item.note === 'Settings page');
  assert.equal(inspectFile(f('Shot.png.meta.json', '{ nope')).ok, false);
  assert.equal(inspectFile(f('Shot.png.meta.json', JSON.stringify({ tags: 'a' }))).ok, false);
  assert.equal(inspectFile(f('Shot.png.meta.json', '[]')).ok, false);
  assert.equal(inspectFile(f('Shot.png.meta.json', '{}')).ok, false);
  const w = inspectFile(f('intro.wav', wav(2)));
  assert.ok(w.ok && w.item.kind === 'audio' && w.item.seconds === 2 && w.item.sampleRate === 22050);
  assert.equal(inspectFile(f('intro.wav', wav(1, 22050, 85))).ok, false, 'compressed WAV refused');
  assert.equal(inspectFile(f('intro.wav', enc('RIFF....WAVE'))).ok, false);
});

test('other types, empty files and oversize files are refused with a reason', () => {
  assert.match(reason(inspectFile(f('a.mov', mp4()))), /not a type Scrimshaw imports/);
  assert.match(reason(inspectFile(f('empty.mp4', new Uint8Array(0)))), /empty/);
  const big = { name: 'big.wav', bytes: { length: 26 * 1024 * 1024 } as unknown as Uint8Array };
  assert.match(reason(inspectFile(big)), /limit is 25 MB/);
});

test('planning pairs captions, chapters and sidecars with their media', () => {
  const plan = planImport([
    f('Lesson 1.mp4', mp4()), f('Lesson 2.webm', webm()),
    f('Lesson 2.vtt', VTT), f('Lesson 1 chapters.vtt', CHAPTERS_VTT), f('Lesson 2 chapters.txt', CHAPTERS_TXT),
    f('Shot.png', png(640, 360)), f('Shot.png.meta.json', JSON.stringify({ note: 'Login screen' })), f('Orphan.png.meta.json', JSON.stringify({ note: 'x' })),
    f('intro.wav', wav(1)), f('notes.docx', 'x'),
  ]);
  assert.equal(plan.videos.length, 2);
  assert.equal(plan.videos[0].chapters?.name, 'Lesson 1 chapters.vtt');
  assert.equal(plan.videos[0].captions, null);
  assert.equal(plan.videos[1].captions?.name, 'Lesson 2.vtt');
  assert.equal(plan.videos[1].chapters?.name, 'Lesson 2 chapters.txt');
  assert.equal(plan.images[0].meta?.note, 'Login screen');
  assert.equal(plan.audio.length, 1);
  assert.deepEqual(plan.rejected.map((r) => r.name), ['notes.docx']);
  assert.ok(plan.warnings.some((w) => /Orphan\.png\.meta\.json/.test(w)));
});

test('a lone video takes a differently named sidecar, and says so; an unmatched one is skipped', () => {
  const lone = planImport([f('take.mp4', mp4()), f('other name.vtt', VTT)]);
  assert.equal(lone.videos[0].captions?.name, 'other name.vtt');
  assert.ok(lone.warnings.some((w) => /only video/.test(w)));
  const two = planImport([f('a.mp4', mp4()), f('b.mp4', mp4()), f('zzz.vtt', VTT)]);
  assert.equal(two.videos.every((v) => v.captions === null), true);
  assert.ok(two.warnings.some((w) => /no matching video/.test(w)));
});

test('applying a plan adds one scene, embedded assets and a course that still loads', () => {
  const c = newCourse('Demo');
  const plan = planImport([
    f('Lesson 1.mp4', mp4()), f('Lesson 1.vtt', VTT), f('Lesson 1 chapters.txt', CHAPTERS_TXT),
    f('Shot.png', png(1920, 1080)), f('Shot.png.meta.json', JSON.stringify({ note: 'Login screen', tags: ['ui'], ocr: 'Sign in' })), f('intro.wav', wav(2.2)),
  ]);
  const before = c.scenes.length;
  const scene = applyImport(c, plan)!;
  assert.equal(c.scenes.length, before + 1);
  assert.equal(scene.slides.length, 3);
  const [video, image, audio] = scene.slides;
  const v = video.layers[0].objects[0];
  assert.equal(v.kind, 'video');
  assert.equal(c.assets[v.src.slice(6)].mime, 'video/mp4');
  assert.ok(c.assets[v.src.slice(6)].data.startsWith('data:video/mp4;base64,'));
  assert.equal(c.assets[v.captions.slice(6)].mime, 'text/vtt');
  assert.equal(video.notes, 'Chapters\n0:00 Intro\n0:30 Demo\n1:02:03 Wrap up');
  const im = image.layers[0].objects[0];
  assert.equal(im.alt, 'Login screen');
  assert.ok(im.w <= 840 && im.h <= 440 && Math.abs(im.w / im.h - 16 / 9) < 0.02);
  assert.match(image.notes, /Sign in/);
  assert.equal(audio.duration, 3);
  assert.equal(audio.layers[0].objects[1].kind, 'audio');
  const reloaded = normalizeCourse(JSON.parse(JSON.stringify(c)));
  assert.equal(reloaded.scenes[reloaded.scenes.length - 1].slides.length, 3);
  assert.equal(applyImport(newCourse('Empty'), planImport([f('x.txt', 'junk')])), null);
});
