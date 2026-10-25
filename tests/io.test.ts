import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCourse, sampleCourse } from '../src/model/factory.ts';
import { CourseFormatError, normalizeCourse, parseCourse, serializeCourse } from '../src/model/schema.ts';
import { buildPlayerHtml, COURSE_SCRIPT_ID, scriptSafeJson } from '../src/export/publish.ts';
import { escapeXml, manifest12, scormId } from '../src/export/scorm.ts';

test('serialize and parse round-trip the sample course', () => {
  const c = sampleCourse();
  const back = parseCourse(serializeCourse(c));
  assert.deepEqual(back, c);
});

test('normalizeCourse fills defaults for sparse input', () => {
  const c = normalizeCourse({ scenes: [{ id: 's', name: 'S', slides: [{ id: 'x', layers: [{ id: 'l', objects: [{ id: 'o', kind: 'text', text: 'Hi' }] }] }] }] });
  const o = c.scenes[0].slides[0].layers[0].objects[0];
  assert.equal(o.text, 'Hi');
  assert.equal(o.style.fontSize, 20);
  assert.equal(c.scenes[0].slides[0].layers[0].base, true);
  assert.equal(c.player.showNav, true);
});

test('normalizeCourse rejects non-courses, newer formats and drops unknown kinds and bad media', () => {
  assert.throws(() => normalizeCourse({}), CourseFormatError);
  assert.throws(() => normalizeCourse({ schema: 99, scenes: [{ id: 'a', slides: [{ id: 'b' }] }] }), /newer Scrimshaw/);
  assert.throws(() => parseCourse('{oops'), /not valid JSON/);
  const c = normalizeCourse({
    scenes: [{ id: 's', slides: [{ id: 'x', layers: [{ id: 'l', objects: [{ id: 'o', kind: 'script' }, { id: 'p', kind: 'shape' }] }] }] }],
    assets: {
      good: { id: 'good', name: 'g', mime: 'image/png', data: 'data:image/png;base64,AAAA' },
      bad: { id: 'bad', name: 'b', mime: 'text/html', data: 'data:text/html;base64,PHNjcmlwdD4=' },
      url: { id: 'url', name: 'u', mime: 'image/png', data: 'https://example.com/x.png' },
    },
  });
  assert.deepEqual(c.scenes[0].slides[0].layers[0].objects.map((o) => o.id), ['p']);
  assert.deepEqual(Object.keys(c.assets), ['good']);
});

test('scriptSafeJson cannot break out of a script element', () => {
  const s = scriptSafeJson({ t: '</script><script>alert(1)</script><!--   & $& $1' });
  assert.ok(!s.includes('</'));
  assert.ok(!s.includes('<!--'));
  assert.deepEqual(JSON.parse(s), { t: '</script><script>alert(1)</script><!--   & $& $1' });
});

test('buildPlayerHtml embeds the course and title safely', () => {
  const c = newCourse('Q&A $& <b>');
  const shell = '<!doctype html><html><head><title>Scrimshaw</title></head><body><div id="root"></div><script data-scrimshaw-bundle>/*app*/</script></body></html>';
  const html = buildPlayerHtml(c, shell);
  assert.ok(html.includes('<title>Q&amp;A $&amp; &lt;b&gt;</title>'));
  const m = html.match(new RegExp(`<script id="${COURSE_SCRIPT_ID}" type="application/json">([\\s\\S]*?)</script>`));
  assert.ok(m);
  assert.equal(JSON.parse(m![1]).title, 'Q&A $& <b>');
  assert.ok(html.indexOf(COURSE_SCRIPT_ID) < html.indexOf('data-scrimshaw-bundle'), 'course is in <head>, before the app runs');
});

test('SCORM 1.2 manifest is well formed and escapes the title', () => {
  const c = newCourse('Ships & "Sails" <1>');
  c.quiz.passPercent = 75;
  const xml = manifest12(c);
  assert.ok(xml.includes('<schemaversion>1.2</schemaversion>'));
  assert.ok(xml.includes('<title>Ships &amp; &quot;Sails&quot; &lt;1&gt;</title>'));
  assert.ok(xml.includes('<adlcp:masteryscore>75</adlcp:masteryscore>'));
  assert.ok(xml.includes('adlcp:scormtype="sco" href="index.html"'));
  c.quiz.reporting = 'completed-incomplete';
  assert.ok(!manifest12(c).includes('masteryscore'));
  assert.equal(scormId('9 bad id!'), '_9_bad_id_');
  assert.equal(escapeXml(`<'&">`), '&lt;&apos;&amp;&quot;&gt;');
});

function fakeWindow(apiName: 'API' | 'API_1484_11', data: Record<string, string>) {
  const calls: string[] = [];
  const ok = () => 'true';
  const api = apiName === 'API'
    ? { LMSInitialize: () => { calls.push('init'); return 'true'; }, LMSFinish: () => { calls.push('finish'); return 'true'; },
        LMSGetValue: (k: string) => data[k] ?? '', LMSSetValue: (k: string, v: string) => { data[k] = v; return 'true'; }, LMSCommit: ok, LMSGetLastError: () => '0' }
    : { Initialize: () => { calls.push('init'); return 'true'; }, Terminate: () => { calls.push('finish'); return 'true'; },
        GetValue: (k: string) => data[k] ?? '', SetValue: (k: string, v: string) => { data[k] = v; return 'true'; }, Commit: ok, GetLastError: () => '0' };
  const top: Record<string, unknown> = { [apiName]: api };
  top.parent = top;
  const child: Record<string, unknown> = { parent: top, opener: null };
  return { win: child as unknown as Window, calls, data };
}

test('SCORM 1.2 adapter: discovery in a parent frame, status, score, suspend, session time', async () => {
  const { connectLms, timespan12 } = await import('../src/export/scorm.ts');
  const f = fakeWindow('API', { 'cmi.core.lesson_status': 'not attempted', 'cmi.core.entry': 'ab-initio' });
  let t = 0;
  const lms = connectLms(f.win, () => t);
  assert.equal(lms.version, '1.2');
  assert.equal(f.data['cmi.core.lesson_status'], 'incomplete');
  lms.setProgress('slide-3', '{"v":1}');
  assert.equal(f.data['cmi.core.lesson_location'], 'slide-3');
  assert.equal(f.data['cmi.core.exit'], 'suspend');
  lms.complete('passed', 87.6);
  assert.equal(f.data['cmi.core.score.raw'], '88');
  assert.equal(f.data['cmi.core.lesson_status'], 'passed');
  t = 3_725_500;
  lms.finish(); lms.finish();
  assert.equal(f.data['cmi.core.session_time'], '0001:02:05.50');
  assert.deepEqual(f.calls, ['init', 'finish']);
  assert.equal(timespan12(0), '0000:00:00.00');
});

test('SCORM 2004 adapter is preferred and maps status and scaled score', async () => {
  const { connectLms, duration2004 } = await import('../src/export/scorm.ts');
  const f = fakeWindow('API_1484_11', { 'cmi.completion_status': 'unknown', 'cmi.entry': 'resume', 'cmi.suspend_data': 'abc', 'cmi.location': 's2' });
  const lms = connectLms(f.win, () => 0);
  assert.equal(lms.version, '2004');
  assert.equal(lms.suspendData, 'abc');
  assert.equal(lms.location, 's2');
  assert.equal(f.data['cmi.completion_status'], 'incomplete');
  lms.complete('failed', 40);
  assert.equal(f.data['cmi.score.scaled'], '0.40');
  assert.equal(f.data['cmi.success_status'], 'failed');
  assert.equal(f.data['cmi.completion_status'], 'completed');
  assert.equal(duration2004(3_725_500), 'PT1H2M5.5S');
});

test('no LMS: adapter is a harmless no-op', async () => {
  const { connectLms } = await import('../src/export/scorm.ts');
  const lone: Record<string, unknown> = { opener: null };
  lone.parent = lone;
  const lms = connectLms(lone as unknown as Window);
  assert.equal(lms.connected, false);
  lms.setProgress('x', 'y'); lms.complete('passed', 1); lms.finish();
});

test('SCORM 2004 manifest declares the passing measure', async () => {
  const { manifest2004 } = await import('../src/export/scorm.ts');
  const c = newCourse('Twenty & four');
  c.quiz.passPercent = 70;
  const xml = manifest2004(c);
  assert.ok(xml.includes('<schemaversion>2004 3rd Edition</schemaversion>'));
  assert.ok(xml.includes('<imsss:minNormalizedMeasure>0.70</imsss:minNormalizedMeasure>'));
  assert.ok(xml.includes('adlcp:scormType="sco"'));
  assert.ok(xml.includes('Twenty &amp; four'));
});

test('texts: collect, find, replace, and CSV translation round-trip', async () => {
  const T = await import('../src/model/texts.ts');
  const { allSlides } = await import('../src/model/query.ts');
  const c = sampleCourse();
  const entries = T.collectTexts(c);
  assert.ok(entries.some((e) => e.field === 'slide title' && e.text === 'Tools of the trade'));
  assert.ok(entries.some((e) => e.field === 'state text' && e.text === 'Needle ✓'));
  assert.ok(T.findTexts(c, 'needle', false).length >= 3);
  assert.equal(T.findTexts(c, 'NEEDLE', true).length, 0);
  const n = T.replaceAll(c, 'Tooth', 'Whale tooth', true);
  assert.ok(n >= 2);
  assert.ok(T.findTexts(c, 'Whale tooth', true).length >= 2);
  const csv = T.textsToCsv(c);
  assert.ok(csv.startsWith('﻿key,where,field,source,translation'));
  const rows = T.parseCsv(csv);
  const titleRow = rows.find((r) => r[0] === `slide:${allSlides(c)[1].id}:title`)!;
  titleRow[4] = 'Werkzeuge, "Handwerk"\nZeile 2';
  const back = rows.map((r) => r.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
  const map = T.csvToTexts(back);
  assert.equal(map.size, 1);
  assert.equal(T.applyTexts(c, map), 1);
  assert.equal(allSlides(c)[1].title, 'Werkzeuge, "Handwerk"\nZeile 2');
  assert.throws(() => T.csvToTexts('a,b\n1,2'), /key/);
});

test('contrast ratio', async () => {
  const { contrast } = await import('../src/model/texts.ts');
  assert.equal(contrast('#ffffff', '#000000')!.toFixed(1), '21.0');
  assert.ok(contrast('#2f74c8', '#ffffff')! >= 4.5, 'kit accent passes AA with white');
  assert.ok(contrast('#e8c15a', '#ffffff')! < 4.5);
  assert.equal(contrast('nope', '#fff'), null);
});

test('slide master: normalized as display-only and included in text tools', async () => {
  const T = await import('../src/model/texts.ts');
  const c = sampleCourse();
  const raw = JSON.parse(serializeCourse(c)).course;
  raw.master.layers.push({ id: 'extra', objects: [] });
  raw.master.layers[0].objects[0].triggers = [{ id: 't', event: { type: 'click' }, action: { type: 'next-slide' }, conditions: [] }];
  const back = normalizeCourse(raw);
  assert.equal(back.master.layers.length, 1);
  assert.equal(back.master.layers[0].objects[0].triggers.length, 0);
  assert.ok(T.collectTexts(back).some((e) => e.where.startsWith('Slide master')));
  const old = normalizeCourse({ ...raw, master: undefined });
  assert.equal(old.master.layers[0].objects.length, 0, 'older files get an empty master');
});
