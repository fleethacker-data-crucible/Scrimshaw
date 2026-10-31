import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEARTBEAT_MS, endSession, isLocalServer, startHeartbeat, type HeartbeatDeps } from '../src/lifecycle.ts';
import { buildPlayerHtml, EDITOR_CONNECT_SRC } from '../src/export/publish.ts';
import { newCourse } from '../src/model/factory.ts';

function fakeDeps() {
  const sent: string[] = [];
  const beacons: string[] = [];
  const handlers = new Map<string, (e: Event) => void>();
  let tick: (() => void) | null = null;
  let tickMs = 0;
  let stopped = false;
  const deps: HeartbeatDeps = {
    send: (b) => { sent.push(b); },
    beacon: (b) => { beacons.push(b); },
    ticker: (cb, ms) => { tick = cb; tickMs = ms; return () => { stopped = true; }; },
    target: { addEventListener: (t: string, h: unknown) => { handlers.set(t, h as (e: Event) => void); }, removeEventListener: (t: string) => { handlers.delete(t); } },
  };
  return { deps, sent, beacons, handlers, fire: () => tick?.(), get tickMs() { return tickMs; }, get stopped() { return stopped; } };
}

test('the heartbeat beats at once, every 5 s, says goodbye on pagehide, and stops cleanly', () => {
  const f = fakeDeps();
  const stop = startHeartbeat(f.deps);
  assert.equal(HEARTBEAT_MS, 5000);
  assert.equal(f.tickMs, 5000);
  assert.deepEqual(f.sent, ['{}']);
  f.fire(); f.fire();
  assert.equal(f.sent.length, 3);
  f.handlers.get('pagehide')!(new Event('pagehide'));
  assert.deepEqual(f.beacons, ['{"leaving":true}']);
  // A page restored from the back/forward cache beats again; a first load does not double up.
  f.handlers.get('pageshow')!({ persisted: false } as unknown as Event);
  assert.equal(f.sent.length, 3);
  f.handlers.get('pageshow')!({ persisted: true } as unknown as Event);
  assert.equal(f.sent.length, 4);
  stop();
  assert.equal(f.stopped, true);
  assert.equal(f.handlers.size, 0);
});

test('only a page served from this machine over http is tracked', () => {
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(isLocalServer({ protocol: 'http:', hostname }), true, hostname);
  assert.equal(isLocalServer({ protocol: 'file:', hostname: '' }), false, 'a published course opened from a file');
  assert.equal(isLocalServer({ protocol: 'https:', hostname: 'lms.example.com' }), false, 'a course on an LMS');
  assert.equal(isLocalServer({ protocol: 'http:', hostname: 'intranet' }), false);
});

test('End session posts the Fleet shutdown request with its header', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = await endSession(((url: string, init: RequestInit) => { calls.push({ url, init }); return Promise.resolve(new Response('{"stopping":true}')); }) as unknown as typeof fetch);
  assert.equal(ok, true);
  assert.equal(calls[0].url, '/__fleethacker/shutdown');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { 'X-FleetHacker-Shutdown': '1' });
  assert.equal(await endSession((() => Promise.resolve(new Response('no', { status: 400 }))) as unknown as typeof fetch), false);
  assert.equal(await endSession((() => Promise.reject(new Error('down'))) as unknown as typeof fetch), false);
});

test('the editor may call its own server, but a published course keeps connect-src none', () => {
  const shell = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; ${EDITOR_CONNECT_SRC}; frame-src 'none'"><title>Scrimshaw</title></head><body></body></html>`;
  const html = buildPlayerHtml(newCourse('Demo'), shell);
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!html.includes("connect-src 'self'"));
  assert.ok(readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8').includes(EDITOR_CONNECT_SRC));
});

test('the server script and its stop script keep to the Fleet rules', () => {
  const start = readFileSync(new URL('../Start.ps1', import.meta.url), 'utf8');
  const stop = readFileSync(new URL('../Stop-Scrimshaw.ps1', import.meta.url), 'utf8');
  for (const needle of ['/__fleethacker/id', '/__fleethacker/shutdown', 'X-FleetHacker-Shutdown', '/api/heartbeat', 'SCRIMSHAW_AUTO_STOP', 'scrimshaw-server-']) assert.ok(start.includes(needle), `Start.ps1 mentions ${needle}`);
  assert.ok(!/Stop-Process/.test(stop.replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')), 'Stop-Scrimshaw.ps1 never kills a process');
  // Windows PowerShell 5.1 misreads non-ASCII text in a script without a BOM.
  for (const [name, text] of [['Start.ps1', start], ['Stop-Scrimshaw.ps1', stop]]) assert.ok(!/[^\x00-\x7f]/.test(text), `${name} is ASCII`);
});
