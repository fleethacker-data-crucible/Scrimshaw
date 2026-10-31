import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import {
  FAIRLEAD_URL, RouterError, chat, defaultRouterSettings, isLoopbackUrl, loadRouterSettings, normalizeRouterSettings, parseQuiz,
  parseStoryboard, quizToSlides, saveRouterSettings, storyboardToScene, type RouterSettings,
} from '../src/ai/router.ts';

// A fake Fairlead. It listens on 127.0.0.1:8776 when that is free (the real address), otherwise on a free port, so
// the test also passes on a PC where the real router is running. Nothing here touches a real model or a key.
interface Seen { method?: string; url?: string; headers: IncomingHttpHeaders; body: { model: string; messages: { role: string; content: string }[] } }
async function fakeRouter(reply: (seen: Seen) => { status?: number; body: unknown } | 'hang'): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const s: Seen = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') };
      seen.push(s);
      const r = reply(s);
      if (r === 'hang') return;
      res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EADDRINUSE') server.listen(0, '127.0.0.1', resolve); else reject(e); });
    server.listen(8776, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}
const completion = (content: string) => ({ body: { choices: [{ message: { role: 'assistant', content } }] } });
const on = (url: string): RouterSettings => ({ ...defaultRouterSettings(), enabled: true, url });

const STORYBOARD = JSON.stringify({ title: 'Safe lifting', slides: [
  { title: 'Why it matters', bullets: ['Back injuries are common', 'Most are avoidable'], notes: 'Open with a story.' },
  { title: '', bullets: ['dropped: no title'] },
  { title: 'The lift', bullets: ['Feet apart', 'Bend the knees', 'Keep the load close'], notes: '' },
] });
const QUIZ = JSON.stringify({ title: 'Lifting check', questions: [
  { kind: 'multiple-choice', question: 'Where do you bend?', choices: ['Back', 'Knees', 'Neck'], correct: 1 },
  { kind: 'true-false', question: 'Keep the load close.', correct: 0 },
  { kind: 'fill-in', question: 'Name one lifting aid.', accepted: ['trolley', 'dolly'] },
  { kind: 'multiple-choice', question: 'Bad index', choices: ['a', 'b'], correct: 7 },
  { kind: 'essay', question: 'Unsupported kind' },
] });

test('the router is off by default and only settings, never a key, are stored', () => {
  const d = defaultRouterSettings();
  assert.equal(d.enabled, false);
  assert.equal(d.url, 'http://127.0.0.1:8776');
  assert.equal(FAIRLEAD_URL, d.url);
  assert.equal(d.localOnly, true);
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  saveRouterSettings({ ...d, enabled: true, key: 'fl-secret' } as RouterSettings, store);
  assert.ok(![...mem.values()].some((v) => v.includes('fl-secret')));
  assert.equal(loadRouterSettings(store).enabled, true);
  assert.deepEqual(loadRouterSettings(null), d);
  assert.deepEqual(normalizeRouterSettings({ enabled: 'yes', url: 'http://evil.example:8776', model: 'x y', localOnly: false }), { ...d, localOnly: false });
});

test('only loopback http addresses are accepted', () => {
  for (const ok of ['http://127.0.0.1:8776', 'http://localhost:9000/', 'http://[::1]:8776']) assert.ok(isLoopbackUrl(ok), ok);
  for (const bad of ['https://127.0.0.1:8776', 'http://192.168.1.5:8776', 'http://127.0.0.1.evil.example', 'http://user:pw@127.0.0.1:8776', 'nonsense']) assert.ok(!isLoopbackUrl(bad), bad);
});

test('a storyboard draft goes to the router with privacy and key headers, and becomes a scene', async () => {
  const router = await fakeRouter(() => completion('Here you go:\n```json\n' + STORYBOARD + '\n```'));
  try {
    const text = await chat('storyboard', 'Safe lifting for warehouse staff', { settings: { ...on(router.url), model: 'smart' }, key: 'fl-test-synthetic' });
    const [req] = router.seen;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers['x-fairlead-privacy'], 'local');
    assert.equal(req.headers['x-fairlead-label'], 'scrimshaw-drafts');
    assert.equal(req.headers.authorization, 'Bearer fl-test-synthetic');
    assert.equal(req.body.model, 'smart');
    assert.equal(req.body.messages[1].content, 'Safe lifting for warehouse staff');
    const draft = parseStoryboard(text);
    assert.equal(draft.slides.length, 2);
    const scene = storyboardToScene(draft);
    assert.equal(scene.name, 'Safe lifting');
    assert.equal(scene.slides[1].layers[0].objects[1].text, '- Feet apart\n- Bend the knees\n- Keep the load close');
    assert.equal(scene.slides[0].notes, 'Open with a story.');
  } finally { await router.close(); }
});

test('local-only can be turned off and no key means no Authorization header', async () => {
  const router = await fakeRouter(() => completion(STORYBOARD));
  try {
    await chat('storyboard', 'x', { settings: { ...on(router.url), localOnly: false } });
    assert.equal(router.seen[0].headers['x-fairlead-privacy'], undefined);
    assert.equal(router.seen[0].headers.authorization, undefined);
  } finally { await router.close(); }
});

test('a quiz draft keeps valid questions and builds graded slides', async () => {
  const router = await fakeRouter(() => completion(QUIZ));
  try {
    const draft = parseQuiz(await chat('quiz', 'Lifting', { settings: on(router.url) }));
    assert.deepEqual(draft.questions.map((q) => q.kind), ['multiple-choice', 'true-false', 'fill-in']);
    const [mc, tf, fill] = quizToSlides(draft);
    const choices = mc.layers[0].objects.filter((o) => o.kind === 'choice');
    assert.deepEqual(choices.map((o) => o.text), ['Back', 'Knees', 'Neck']);
    assert.deepEqual(choices.map((o) => o.correct), [false, true, false]);
    assert.equal(new Set(mc.layers[0].objects.map((o) => o.id)).size, mc.layers[0].objects.length);
    assert.equal(mc.question?.kind, 'multiple-choice');
    assert.equal(tf.layers[0].objects.filter((o) => o.kind === 'choice' && o.correct).length, 1);
    assert.deepEqual(fill.question?.accepted, ['trolley', 'dolly']);
    assert.ok(mc.layers[0].objects.some((o) => o.name === 'Question' && o.text === 'Where do you bend?'));
  } finally { await router.close(); }
});

test('multiple-choice slides can grow past the four-option template', () => {
  const [slide] = quizToSlides({ title: 't', questions: [{ kind: 'multiple-choice', question: 'Pick', choices: ['a', 'b', 'c', 'd', 'e'], correct: 4, accepted: [] }] });
  const choices = slide.layers[0].objects.filter((o) => o.kind === 'choice');
  assert.equal(choices.length, 5);
  assert.equal(choices[4].correct, true);
  assert.notEqual(choices[4].style, choices[0].style);
});

test('failures are clear and typed: off, bad address, refused, unreachable, bad reply', async () => {
  const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as RouterError).code; } return 'none'; };
  assert.equal(await code(chat('quiz', 'x', { settings: defaultRouterSettings(), fetchImpl: () => assert.fail('must not call') })), 'disabled');
  assert.equal(await code(chat('quiz', 'x', { settings: { ...defaultRouterSettings(), enabled: true, url: 'http://example.com' }, fetchImpl: () => assert.fail('must not call') })), 'bad-address');
  const router = await fakeRouter((s) => (s.headers.authorization ? { status: 401, body: {} } : s.body.model === 'junk' ? completion('no json here') : { body: { choices: [] } }));
  try {
    assert.equal(await code(chat('quiz', 'x', { settings: on(router.url), key: 'wrong' })), 'rejected');
    assert.equal(await code(chat('quiz', 'x', { settings: on(router.url) })), 'bad-reply');
    const text = await chat('quiz', 'x', { settings: { ...on(router.url), model: 'junk' } });
    assert.throws(() => parseQuiz(text), RouterError);
    assert.throws(() => parseStoryboard('{"slides": []}'), RouterError);
  } finally { await router.close(); }
  assert.equal(await code(chat('quiz', 'x', { settings: on('http://127.0.0.1:1') })), 'unreachable');
});

test('no key or token is written in the source', () => {
  const files = readdirSync(new URL('../src/ai/', import.meta.url));
  assert.ok(files.includes('router.ts'));
  for (const f of files) assert.ok(!/fl-[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{8,}/.test(readFileSync(new URL(`../src/ai/${f}`, import.meta.url), 'utf8')), f);
});

test('the editor may reach the router but a published course never can', async () => {
  const { buildPlayerHtml, EDITOR_CONNECT_SRC } = await import('../src/export/publish.ts');
  const { newCourse } = await import('../src/model/factory.ts');
  const shell = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; ${EDITOR_CONNECT_SRC}; frame-src 'none'"><title>Scrimshaw</title></head><body></body></html>`;
  const html = buildPlayerHtml(newCourse('Demo'), shell);
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!html.includes('8776'));
  const built = readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8');
  assert.ok(built.includes(EDITOR_CONNECT_SRC));
});
