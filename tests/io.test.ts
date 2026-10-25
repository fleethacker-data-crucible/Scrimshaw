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
