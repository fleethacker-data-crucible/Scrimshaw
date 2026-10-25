import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCourse, newLayer, newObject, newQuestionSlide, newSlide, newTrigger, sampleCourse } from '../src/model/factory.ts';
import { allSlides, findSlide, slideObjects, slideLinks } from '../src/model/query.ts';
import { initEditor, reduce, MERGE_MS } from '../src/store/history.ts';
import { align, copySlide, deleteLayer, deleteObjects, deleteSlide, distribute, pruneAssets, reorder } from '../src/store/ops.ts';
import { validateCourse, describeTrigger } from '../src/model/describe.ts';

test('history: edit, undo, redo', () => {
  let s = initEditor(newCourse('A'));
  s = reduce(s, { type: 'edit', label: 'Rename', fn: (c) => { c.title = 'B'; } });
  assert.equal(s.course.title, 'B');
  assert.equal(s.past.length, 1);
  s = reduce(s, { type: 'undo' });
  assert.equal(s.course.title, 'A');
  s = reduce(s, { type: 'redo' });
  assert.equal(s.course.title, 'B');
  s = reduce(s, { type: 'undo' });
  s = reduce(s, { type: 'edit', label: 'Other', fn: (c) => { c.author = 'X'; } });
  assert.equal(s.future.length, 0, 'a new edit clears redo');
});

test('history: edits with the same mergeKey inside the window collapse', () => {
  let s = initEditor(newCourse('A'));
  const t0 = 1_000_000;
  s = reduce(s, { type: 'edit', label: 'Type', fn: (c) => { c.title = 'Ab'; }, mergeKey: 'title', now: t0 });
  s = reduce(s, { type: 'edit', label: 'Type', fn: (c) => { c.title = 'Abc'; }, mergeKey: 'title', now: t0 + 100 });
  assert.equal(s.past.length, 1);
  s = reduce(s, { type: 'edit', label: 'Type', fn: (c) => { c.title = 'Abcd'; }, mergeKey: 'title', now: t0 + 100 + MERGE_MS + 1 });
  assert.equal(s.past.length, 2);
  s = reduce(s, { type: 'undo' });
  s = reduce(s, { type: 'undo' });
  assert.equal(s.course.title, 'A');
});

test('history: a throwing edit leaves state untouched, and assets are shared not copied', () => {
  const c = newCourse();
  c.assets = { a1: { id: 'a1', name: 'x.png', mime: 'image/png', data: 'data:image/png;base64,AAAA' } };
  const s0 = initEditor(c);
  const orig = console.error;
  console.error = () => {};
  const s1 = reduce(s0, { type: 'edit', label: 'Boom', fn: () => { throw new Error('boom'); } });
  console.error = orig;
  assert.equal(s1, s0);
  const s2 = reduce(s0, { type: 'edit', label: 'Ok', fn: (d) => { d.title = 'y'; } });
  assert.equal(s2.course.assets, s0.course.assets);
});

test('history: selection is repaired after deleting the selected object', () => {
  const c = newCourse();
  const slide = c.scenes[0].slides[0];
  const o = slide.layers[0].objects[0];
  let s = reduce(initEditor(c), { type: 'select', sel: { objectIds: [o.id] } });
  assert.deepEqual(s.sel.objectIds, [o.id]);
  s = reduce(s, { type: 'edit', label: 'Delete', fn: (d) => { deleteObjects(findSlide(d, slide.id)!, [o.id]); } });
  assert.deepEqual(s.sel.objectIds, []);
});

test('copySlide gives fresh ids and rewires internal references', () => {
  const q = newQuestionSlide('multiple-choice');
  const copy = copySlide(q);
  const ids = (s: typeof q) => new Set([s.id, ...s.layers.map((l) => l.id), ...slideObjects(s).map((o) => o.id)]);
  const a = ids(q);
  for (const id of ids(copy)) assert.ok(!a.has(id), 'no id is shared');
  assert.ok(copy.layers.some((l) => l.id === copy.question!.correctLayerId));
  const tryAgain = copy.layers.find((l) => l.id === copy.question!.tryAgainLayerId)!;
  assert.ok(tryAgain);
  const showLayer = newSlide();
  const layer = newLayer('L');
  const btn = newObject('button');
  btn.triggers.push(newTrigger({ type: 'click' }, { type: 'show-layer', layerId: layer.id }));
  showLayer.layers.push(layer);
  showLayer.layers[0].objects.push(btn);
  const c2 = copySlide(showLayer);
  const t = c2.layers[0].objects[0].triggers[0].action as { layerId: string };
  assert.equal(t.layerId, c2.layers[1].id);
});

test('deleteSlide removes jump triggers aimed at it and keeps at least one slide', () => {
  const c = newCourse();
  const s2 = newSlide('Two');
  c.scenes[0].slides.push(s2);
  const b = newObject('button');
  b.triggers.push(newTrigger({ type: 'click' }, { type: 'jump-slide', slideId: s2.id }));
  c.scenes[0].slides[0].layers[0].objects.push(b);
  assert.equal(deleteSlide(c, s2.id), c.scenes[0].slides[0].id);
  assert.equal(b.triggers.length, 0);
  assert.equal(deleteSlide(c, c.scenes[0].slides[0].id), null);
});

test('deleteLayer clears triggers and question links to it', () => {
  const q = newQuestionSlide('true-false');
  const correct = q.question!.correctLayerId!;
  deleteLayer(q, correct);
  assert.equal(q.question!.correctLayerId, null);
  assert.ok(!q.layers.some((l) => l.id === correct));
  deleteLayer(q, q.layers[0].id);
  assert.equal(q.layers[0].base, true, 'base layer cannot be deleted');
});

test('reorder, align and distribute', () => {
  const l = newLayer('L');
  const [a, b, c] = ['a', 'b', 'c'].map((n, i) => newObject('shape', { name: n, x: i * 100, y: i * 10, w: 50, h: 50 }));
  l.objects.push(a, b, c);
  reorder(l, [a.id], 'front');
  assert.deepEqual(l.objects.map((o) => o.name), ['b', 'c', 'a']);
  reorder(l, [a.id], 'backward');
  assert.deepEqual(l.objects.map((o) => o.name), ['b', 'a', 'c']);
  reorder(l, [c.id], 'back');
  assert.deepEqual(l.objects.map((o) => o.name), ['c', 'b', 'a']);
  align([a, b, c], 'top', { w: 960, h: 540 });
  assert.deepEqual([a.y, b.y, c.y], [0, 0, 0]);
  align([a], 'hcenter', { w: 960, h: 540 });
  assert.equal(a.x, 455);
  a.x = 0; b.x = 30; c.x = 300;
  distribute([a, b, c], 'h');
  assert.equal(b.x, 150);
});

test('pruneAssets keeps only referenced media', () => {
  const c = newCourse();
  c.assets = {
    used: { id: 'used', name: 'a', mime: 'image/png', data: 'data:image/png;base64,AA' },
    bg: { id: 'bg', name: 'b', mime: 'image/png', data: 'data:image/png;base64,AA' },
    gone: { id: 'gone', name: 'c', mime: 'image/png', data: 'data:image/png;base64,AA' },
  };
  c.scenes[0].slides[0].layers[0].objects.push(newObject('image', { src: 'asset:used' }));
  c.scenes[0].slides[0].background = 'asset:bg';
  assert.deepEqual(Object.keys(pruneAssets(c)).sort(), ['bg', 'used']);
});

test('validateCourse flags broken references and missing alt text', () => {
  const c = newCourse();
  const b = newObject('button');
  b.triggers.push(newTrigger({ type: 'click' }, { type: 'show-layer', layerId: 'nope' }));
  c.scenes[0].slides[0].layers[0].objects.push(b, newObject('image', { name: 'Photo' }));
  const p = validateCourse(c);
  assert.ok(p.some((x) => x.includes('layer that no longer exists')));
  assert.ok(p.some((x) => x.includes('Photo') && x.includes('alt text')));
  assert.deepEqual(validateCourse(sampleCourse()), [], 'the sample course is clean');
});

test('trigger descriptions and story links read naturally', () => {
  const c = sampleCourse();
  const tools = allSlides(c)[1];
  const btn = tools.layers[0].objects.find((o) => o.name === 'Needle button')!;
  const d = describeTrigger(c, tools, btn.triggers[1], btn);
  assert.equal(d.action, 'Show layer Needle');
  assert.equal(d.when, 'user clicks Needle button');
  const first = describeTrigger(c, tools, btn.triggers[0], btn);
  assert.equal(first.conditions, 'Needle button is not Visited');
  assert.deepEqual(slideLinks(c, tools).map((l) => l.to), [allSlides(c)[2].id]);
});
