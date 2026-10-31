import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildDocx, docxParts } from '../src/export/docx.ts';
import { newCourse, newQuestionSlide, sampleCourse } from '../src/model/factory.ts';
import { newTrigger } from '../src/model/factory.ts';

/** A small well-formedness check: tags nest and close, and only the five XML entities appear. */
function assertWellFormed(xml: string, name: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: </${m[2]}> closes the open tag`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, [], `${name}: every tag is closed`);
  assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(body), `${name}: no stray ampersand`);
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body), `${name}: no control characters`);
  assert.equal(body.replace(/<[^>]*>/g, '').includes('<'), false, `${name}: no stray <`);
}

test('the handout is a Word package: required parts, well-formed XML, and the course text', async () => {
  const c = sampleCourse();
  const zip = await JSZip.loadAsync(await (await buildDocx(c)).arrayBuffer());
  const names = Object.keys(zip.files);
  assert.equal(names[0], '[Content_Types].xml');
  for (const p of ['_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) assert.ok(names.includes(p), p);
  for (const p of names) assertWellFormed(await zip.file(p)!.async('string'), p);
  const doc = await zip.file('word/document.xml')!.async('string');
  const text = doc.replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '');
  assert.ok(text.includes(c.title));
  for (const sl of c.scenes.flatMap((s) => s.slides)) assert.ok(text.includes(sl.title.replace(/&/g, '&amp;')) || text.includes(sl.title), `slide "${sl.title}" is in the handout`);
  assert.match(doc, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(text, /Question: Multiple choice/);
  assert.match(text, /\[correct\]/);
  // The styles the paragraphs use are defined.
  const styles = await zip.file('word/styles.xml')!.async('string');
  for (const id of ['Title', 'Heading1', 'Heading2', 'Normal']) assert.ok(styles.includes(`w:styleId="${id}"`), id);
});

test('awkward text is escaped, line breaks survive, and invalid characters are dropped', () => {
  const c = newCourse('Fish & <Chips> "quoted"');
  c.description = 'Line one\nLine two \u0001 end';
  const q = newQuestionSlide('fill-in');
  q.title = 'Q <1> & more';
  q.question!.accepted = ['a&b', '<c>'];
  q.notes = 'Note with \u0008 control';
  q.layers[0].triggers.push(newTrigger({ type: 'timeline-start' } as never, { type: 'next-slide' } as never));
  c.scenes[0].slides = [q];
  const parts = docxParts(c);
  const doc = parts['word/document.xml'];
  assertWellFormed(doc, 'document.xml');
  assert.ok(doc.includes('Fish &amp; &lt;Chips&gt; &quot;quoted&quot;'));
  assert.ok(doc.includes('Q &lt;1&gt; &amp; more'));
  assert.ok(doc.includes('a&amp;b | &lt;c&gt;'));
  assert.ok(doc.includes('Line one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">Line two  end'));
  assert.ok(!/[\u0001\u0008]/.test(doc));
});

test('the output is deterministic (no dates or random ids)', () => {
  const c = sampleCourse();
  assert.deepEqual(docxParts(c), docxParts(c));
});
