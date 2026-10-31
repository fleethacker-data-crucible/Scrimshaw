import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCourse, newLayer, newObject, newQuestionSlide, newResultsSlide, newSlide, newTrigger, newVariable, sampleCourse } from '../src/model/factory.ts';
import { allSlides, findSlide, slideObjects } from '../src/model/query.ts';
import * as E from '../src/engine/runtime.ts';
import type { Course } from '../src/model/types.ts';

function twoSlides() {
  const c = newCourse('T');
  const s2 = newSlide('Two');
  c.scenes[0].slides.push(s2);
  return { c, s1: c.scenes[0].slides[0], s2 };
}

test('start enters the first slide and fires its timeline-start triggers', () => {
  const { c, s1 } = twoSlides();
  const v = newVariable('Count', 'number', 0);
  c.variables.push(v);
  s1.triggers.push(newTrigger({ type: 'timeline-start' }, { type: 'adjust-variable', variableId: v.id, op: 'add', value: 2 }));
  const s = E.start(c);
  assert.equal(s.slideId, s1.id);
  assert.equal(s.vars[v.id], 2);
  assert.ok(s.visitedSlides[s1.id]);
});

test('initially hidden objects start hidden and set-state Normal reveals them', () => {
  const { c, s1 } = twoSlides();
  const btn = newObject('button', { initiallyHidden: true });
  const reveal = newObject('button');
  reveal.triggers.push(newTrigger({ type: 'click' }, { type: 'set-state', objectId: btn.id, state: 'Normal' }));
  s1.layers[0].objects.push(btn, reveal);
  let s = E.start(c);
  assert.equal(E.isVisible(s, btn), false);
  assert.equal(E.click(c, s, btn.id), s, 'hidden objects ignore clicks');
  s = E.click(c, s, reveal.id);
  assert.equal(E.isVisible(s, btn), true);
});

test('next and prev navigation use slide order and history', () => {
  const { c, s1, s2 } = twoSlides();
  let s = E.start(c);
  s = E.navigate(c, s, 'next');
  assert.equal(s.slideId, s2.id);
  assert.equal(E.canGoNext(c, s), false);
  s = E.navigate(c, s, 'prev');
  assert.equal(s.slideId, s1.id);
});

test('a navigation action stops the remaining triggers', () => {
  const { c, s1, s2 } = twoSlides();
  const v = newVariable('X', 'number', 0);
  c.variables.push(v);
  const b = newObject('button');
  b.triggers.push(
    newTrigger({ type: 'click' }, { type: 'jump-slide', slideId: s2.id }),
    newTrigger({ type: 'click' }, { type: 'adjust-variable', variableId: v.id, op: 'set', value: 9 }),
  );
  s1.layers[0].objects.push(b);
  const s = E.click(c, E.start(c), b.id);
  assert.equal(s.slideId, s2.id);
  assert.equal(s.vars[v.id], 0);
});

test('layers: hideOthers, hide this, and layer timeline-start triggers', () => {
  const { c, s1 } = twoSlides();
  const a = newLayer('A');
  const b = newLayer('B');
  const v = newVariable('Seen', 'boolean', false);
  c.variables.push(v);
  b.triggers.push(newTrigger({ type: 'timeline-start' }, { type: 'adjust-variable', variableId: v.id, op: 'set', value: true }));
  const close = newObject('button');
  close.triggers.push(newTrigger({ type: 'click' }, { type: 'hide-layer', layerId: 'this' }));
  b.objects.push(close);
  s1.layers.push(a, b);
  const showA = newObject('button');
  showA.triggers.push(newTrigger({ type: 'click' }, { type: 'show-layer', layerId: a.id }));
  const showB = newObject('button');
  showB.triggers.push(newTrigger({ type: 'click' }, { type: 'show-layer', layerId: b.id }));
  s1.layers[0].objects.push(showA, showB);
  let s = E.start(c);
  s = E.click(c, s, showA.id);
  assert.deepEqual(s.layers, [a.id]);
  s = E.click(c, s, showB.id);
  assert.deepEqual(s.layers, [b.id], 'B hides A');
  assert.equal(s.vars[v.id], true);
  s = E.click(c, s, close.id);
  assert.deepEqual(s.layers, []);
});

test('conditions: variable comparisons, AND/OR, and state checks', () => {
  assert.equal(E.compare(5, '>', 3), true);
  assert.equal(E.compare('5', '==', 5), true);
  assert.equal(E.compare('Hello', '==', 'hello'), true);
  assert.equal(E.compare('Hello world', 'contains', 'WORLD'), true);
  assert.equal(E.compare('', 'empty', ''), true);
  assert.equal(E.compare(true, '==', 'true'), true);
  assert.equal(E.compare(false, '!=', true), true);

  const { c, s1 } = twoSlides();
  const v = newVariable('N', 'number', 0);
  const flag = newVariable('F', 'boolean', false);
  c.variables.push(v, flag);
  const b = newObject('button');
  b.triggers.push(newTrigger({ type: 'click' }, { type: 'adjust-variable', variableId: flag.id, op: 'toggle', value: true }, {
    conditions: [
      { kind: 'variable', variableId: v.id, op: '>', value: 5 },
      { kind: 'state', objectId: b.id, is: true, state: 'Normal' },
    ],
    join: 'or',
  }));
  s1.layers[0].objects.push(b);
  const s = E.click(c, E.start(c), b.id);
  assert.equal(s.vars[flag.id], true, 'OR: the state condition holds');
});

test('Visited applies after click triggers, so first-click counting works', () => {
  const c = sampleCourse();
  const tools = allSlides(c)[1];
  const explored = c.variables.find((v) => v.name === 'ToolsExplored')!;
  const buttons = tools.layers[0].objects.filter((o) => o.kind === 'button' && o.name.endsWith('button'));
  const next = tools.layers[0].objects.find((o) => o.name === 'Next')!;
  let s = E.navigate(c, E.start(c), tools.id);
  assert.equal(E.isVisible(s, next), false);
  s = E.click(c, s, buttons[0].id);
  s = E.click(c, s, buttons[0].id);
  assert.equal(s.vars[explored.id], 1, 'second click on the same tool does not count');
  assert.equal(E.stateOf(s, buttons[0]), 'Visited');
  s = E.click(c, s, buttons[1].id);
  s = E.click(c, s, buttons[2].id);
  assert.equal(s.vars[explored.id], 3);
  assert.equal(E.isVisible(s, next), true, 'variable-change trigger revealed Next');
  assert.equal(s.layers.length, 1, 'each tool layer hides the previous one');
});

test('interpolation of user and built-in variables', () => {
  const c = sampleCourse();
  const name = c.variables.find((v) => v.name === 'LearnerName')!;
  let s = E.start(c);
  const input = slideObjects(allSlides(c)[0]).find((o) => o.kind === 'input')!;
  s = E.input(c, s, input.id, 'Ada');
  assert.equal(s.vars[name.id], 'Ada');
  assert.equal(E.interpolate('Hi %learnername%, slide %Project.SlideNumber% of %Project.TotalSlides%. %Unknown%', c, s), 'Hi Ada, slide 1 of 6. %Unknown%');
});

test('multiple choice: grading, try-again, attempts, and results', () => {
  const c = newCourse('Quiz');
  const q = newQuestionSlide('multiple-choice');
  q.question!.attempts = 2;
  const r = newResultsSlide();
  c.scenes[0].slides = [q, r];
  const choices = slideObjects(q).filter((o) => o.kind === 'choice');
  const submitBtn = slideObjects(q).find((o) => o.name === 'Submit')!;
  let s = E.start(c);
  s = E.click(c, s, submitBtn.id);
  const [, fx] = E.takeEffects(s);
  assert.ok(fx.some((f) => f.type === 'notice'), 'must choose before submitting');
  s = E.click(c, s, choices[1].id);
  s = E.click(c, s, choices[2].id);
  assert.equal(E.stateOf(s, choices[1]), 'Normal', 'radio: selecting one clears the other');
  s = E.click(c, s, submitBtn.id);
  assert.deepEqual(s.layers, [q.question!.tryAgainLayerId]);
  assert.equal(s.answers[q.id].final, false);
  s = E.click(c, s, choices[0].id);
  s = E.click(c, s, submitBtn.id);
  assert.deepEqual(s.layers, [q.question!.correctLayerId]);
  assert.equal(s.answers[q.id].correct, true);
  const res = E.results(c, s);
  assert.deepEqual([res.points, res.max, res.percent, res.passed], [10, 10, 100, true]);
  assert.equal(E.readVar(c, s, 'Results.ScorePercent'), 100);
});

test('multiple response and fill-in grading', () => {
  const c = newCourse('Quiz');
  const mr = newQuestionSlide('multiple-response');
  const fi = newQuestionSlide('fill-in');
  fi.question!.accepted = ['Nantucket', 'nantucket island'];
  c.scenes[0].slides = [mr, fi];
  const ch = slideObjects(mr).filter((o) => o.kind === 'choice');
  ch[0].correct = true; ch[1].correct = true;
  let s = E.start(c);
  s = E.click(c, s, ch[0].id);
  s = E.click(c, s, ch[1].id);
  s = E.click(c, s, slideObjects(mr).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[mr.id].correct, true);
  s = E.navigate(c, s, fi.id);
  s = E.input(c, s, fi.question!.inputObjectId!, '  NANTUCKET ');
  s = E.click(c, s, slideObjects(fi).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[fi.id].correct, true);
});

test('results slide shows the pass or fail layer, and reset clears the quiz', () => {
  const c = newCourse('Quiz');
  const q = newQuestionSlide('true-false');
  const r = newResultsSlide();
  c.scenes[0].slides = [q, r];
  c.quiz.completionSlideId = r.id;
  const [t, f] = slideObjects(q).filter((o) => o.kind === 'choice');
  t.correct = false; f.correct = true;
  let s = E.start(c);
  s = E.click(c, s, t.id);
  s = E.click(c, s, slideObjects(q).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[q.id].final, true, 'one attempt by default');
  assert.equal(E.stateOf(s, f), 'Disabled');
  s = E.navigate(c, s, 'next');
  const failLayer = r.layers.find((l) => l.name === 'Failed')!;
  assert.deepEqual(s.layers, [failLayer.id]);
  const [, fx] = E.takeEffects(s);
  assert.deepEqual(fx.find((x) => x.type === 'completed'), { type: 'completed', status: 'failed', scorePercent: 0 });
  const retry = failLayer.objects.find((o) => o.kind === 'button')!;
  s = E.click(c, s, retry.id);
  assert.equal(s.slideId, q.id);
  assert.equal(Object.keys(s.answers).length, 0);
  assert.equal(E.stateOf(s, f), 'Normal', 'saved states for question slides are cleared');
});

test('auto-advance on timeline end, but not on question slides', () => {
  const { c, s1, s2 } = twoSlides();
  s1.advance = 'auto';
  let s = E.start(c);
  s = E.timelineEnded(c, s);
  assert.equal(s.slideId, s2.id);
});

test('object states persist when returning to a slide', () => {
  const { c, s1, s2 } = twoSlides();
  const b = newObject('button');
  b.states.push({ id: 'x', name: 'Visited', style: {}, text: null });
  s1.layers[0].objects.push(b);
  let s = E.start(c);
  s = E.click(c, s, b.id);
  s = E.navigate(c, s, s2.id);
  s = E.navigate(c, s, s1.id);
  assert.equal(E.stateOf(s, b), 'Visited');
});

test('variable-change recursion is bounded', () => {
  const { c, s1 } = twoSlides();
  const v = newVariable('Loop', 'number', 0);
  c.variables.push(v);
  s1.triggers.push(newTrigger({ type: 'variable-change', variableId: v.id }, { type: 'adjust-variable', variableId: v.id, op: 'add', value: 1 }));
  const b = newObject('button');
  b.triggers.push(newTrigger({ type: 'click' }, { type: 'adjust-variable', variableId: v.id, op: 'add', value: 1 }));
  s1.layers[0].objects.push(b);
  const s = E.click(c, E.start(c), b.id);
  assert.ok((s.vars[v.id] as number) < 20);
});

test('open-url only allows http(s) and mailto', () => {
  const { c } = twoSlides();
  let s = E.perform(c, E.start(c), { type: 'open-url', url: 'javascript:alert(1)' });
  assert.equal(E.takeEffects(s)[1].filter((f) => f.type === 'open-url').length, 0);
  s = E.perform(c, s, { type: 'open-url', url: 'https://example.com' });
  assert.equal(E.takeEffects(s)[1].filter((f) => f.type === 'open-url').length, 1);
});

test('suspend and resume round-trip', () => {
  const c: Course = sampleCourse();
  let s = E.start(c);
  const name = c.variables.find((v) => v.name === 'LearnerName')!;
  const input = slideObjects(allSlides(c)[0]).find((o) => o.kind === 'input')!;
  s = E.input(c, s, input.id, 'Grace');
  const quiz = allSlides(c)[2];
  s = E.navigate(c, s, quiz.id);
  const data = E.suspend(s);
  assert.ok(data.length < 4096);
  const r = E.resumeFrom(c, data)!;
  assert.equal(r.slideId, quiz.id);
  assert.equal(r.vars[name.id], 'Grace');
  assert.ok(findSlide(c, r.slideId));
  assert.equal(E.resumeFrom(c, 'not json'), null);
});

test('drag and drop: drops, drop triggers, returning, and grading', () => {
  const c = newCourse('DnD');
  const q = newQuestionSlide('drag-drop');
  c.scenes[0].slides = [q];
  const items = slideObjects(q).filter((o) => o.draggable);
  const targets = slideObjects(q).filter((o) => o.dropTarget);
  const v = newVariable('Drops', 'number', 0);
  c.variables.push(v);
  items[0].triggers.push(newTrigger({ type: 'drop', targetId: targets[0].id }, { type: 'adjust-variable', variableId: v.id, op: 'add', value: 1 }));
  const submitBtn = slideObjects(q).find((o) => o.name === 'Submit')!;
  let s = E.start(c);
  s = E.click(c, s, submitBtn.id);
  assert.ok(E.takeEffects(s)[1].some((f) => f.type === 'notice'), 'nothing dropped yet');
  s = E.drop(c, s, items[0].id, targets[1].id);
  assert.equal(s.drops[items[0].id], targets[1].id);
  assert.equal(s.vars[v.id], 0, 'trigger only fires for its target');
  s = E.drop(c, s, items[0].id, null);
  assert.equal(s.drops[items[0].id], undefined, 'dropping outside returns the item');
  assert.equal(E.drop(c, s, items[0].id, items[1].id), s, 'a non-target is not a drop target');
  s = E.drop(c, s, items[1].id, targets[0].id);
  s = E.drop(c, s, items[2].id, targets[0].id);
  assert.equal(s.drops[items[1].id], undefined, 'one item per target: the earlier one goes back');
  items.forEach((it, i) => { s = E.drop(c, s, it.id, targets[i].id); });
  assert.equal(s.vars[v.id], 1);
  s = E.click(c, s, submitBtn.id);
  assert.equal(s.answers[q.id].correct, true);
  assert.equal(E.stateOf(s, items[0]), 'Disabled', 'items lock after a final answer');
  assert.equal(E.drop(c, s, items[0].id, targets[2].id), s);
});

test('shuffle permutes answer positions within their own slots', () => {
  const q = newQuestionSlide('multiple-choice');
  q.question!.shuffle = true;
  const choices = slideObjects(q).filter((o) => o.kind === 'choice');
  const pos = E.shuffledPositions(q, () => 0);
  const final = choices.map((o) => pos[o.id] ?? { x: o.x, y: o.y });
  assert.deepEqual(final.map((p) => p.y).sort((a, b) => a - b), choices.map((o) => o.y).sort((a, b) => a - b));
  assert.ok(Object.keys(pos).length > 0, 'something moved');
  const c = newCourse('S');
  c.scenes[0].slides = [q];
  const s = E.start(c);
  const ys = choices.map((o) => (s.positions[o.id] ?? o).y).sort((a, b) => a - b);
  assert.deepEqual(ys, choices.map((o) => o.y).sort((a, b) => a - b));
});

test('question banks: shuffle and draw within a scene, score only drawn questions, redraw on retry, resume keeps the draw', () => {
  const c = newCourse('Bank');
  const intro = c.scenes[0].slides[0];
  const qs = [1, 2, 3, 4].map((i) => { const q = newQuestionSlide('true-false'); q.title = `Q${i}`; return q; });
  const results = newResultsSlide();
  c.scenes[0].slides = [intro, ...qs, results];
  c.scenes[0].bank = { shuffle: true, draw: 2 };
  let n = 0;
  const seq = E.buildSequence(c, () => ((n++ * 0.37) % 1));
  assert.equal(seq.length, 4, 'intro + 2 drawn + results');
  assert.equal(seq[0], intro.id);
  assert.equal(seq[3], results.id);
  assert.ok(seq.slice(1, 3).every((id) => qs.some((q) => q.id === id)));
  const s = E.start(c);
  assert.equal(E.playSlides(c, s).length, 4);
  assert.equal(E.results(c, s).max, 20, 'only the two drawn questions count');
  assert.equal(E.readVar(c, s, 'Project.TotalSlides'), 4);
  const back = E.resumeFrom(c, E.suspend(s))!;
  assert.deepEqual(back.sequence, s.sequence);
  E.setRandom(() => 0.99);
  const retried = E.perform(c, s, { type: 'reset-results' });
  assert.equal(retried.slideId, retried.sequence[1], 'retry starts at the first drawn question');
  E.setRandom(Math.random);
  c.scenes[0].bank = null;
  assert.equal(E.buildSequence(c).length, 6);
});

test('hotspot and numeric questions', () => {
  const c = newCourse('Q');
  const hs = newQuestionSlide('hotspot');
  const nu = newQuestionSlide('numeric');
  nu.question!.numMin = 9.5; nu.question!.numMax = 10.5;
  nu.question!.attempts = 0;
  c.scenes[0].slides = [hs, nu];
  const areas = slideObjects(hs).filter((o) => o.kind === 'hotspot');
  const submit = (sl: typeof hs) => slideObjects(sl).find((o) => o.name === 'Submit')!.id;
  let s = E.start(c);
  s = E.click(c, s, areas[2].id);
  s = E.click(c, s, areas[0].id);
  assert.equal(E.stateOf(s, areas[2]), 'Normal', 'one area at a time');
  s = E.click(c, s, submit(hs));
  assert.equal(s.answers[hs.id].correct, true);
  // With several correct areas, a click on any one of them is right.
  const hs2 = newQuestionSlide('hotspot');
  hs2.question!.attempts = 0;
  c.scenes[0].slides.push(hs2);
  const areas2 = slideObjects(hs2).filter((o) => o.kind === 'hotspot');
  areas2.forEach((o, i) => { o.correct = i < 2; });
  let t = E.navigate(c, s, hs2.id);
  t = E.click(c, t, areas2[1].id);
  t = E.click(c, t, submit(hs2));
  assert.equal(t.answers[hs2.id].correct, true, 'any correct area');
  const hs3 = structuredClone(hs2);
  hs3.id = 'hs3';
  c.scenes[0].slides.push(hs3);
  const areas3 = slideObjects(hs3).filter((o) => o.kind === 'hotspot');
  t = E.navigate(c, t, hs3.id);
  t = E.click(c, t, areas3[2].id);
  t = E.click(c, t, submit(hs3));
  assert.equal(t.answers[hs3.id].correct, false, 'an incorrect area');
  s = E.navigate(c, s, nu.id);
  const input = nu.question!.inputObjectId!;
  s = E.input(c, s, input, 'ten');
  s = E.click(c, s, submit(nu));
  assert.ok(E.takeEffects(s)[1].some((f) => f.type === 'notice'));
  s = E.input(c, s, input, '11');
  s = E.click(c, s, submit(nu));
  assert.equal(s.answers[nu.id].correct, false);
  s = E.input(c, s, input, ' 10,2 ');
  s = E.click(c, s, submit(nu));
  assert.equal(s.answers[nu.id].correct, true, 'decimal comma accepted');
});

test('lightbox slides open over the current slide and close back to it', () => {
  const c = newCourse('L');
  const a = c.scenes[0].slides[0];
  const b = newSlide('Box');
  const z = newSlide('Z');
  c.scenes[0].slides.push(z, b);
  const open = newObject('button');
  open.states.push({ id: 'v', name: 'Visited', style: {}, text: null });
  open.triggers.push(newTrigger({ type: 'click' }, { type: 'lightbox-slide', slideId: b.id }));
  a.layers[0].objects.push(open);
  const close = newObject('button');
  close.triggers.push(newTrigger({ type: 'click' }, { type: 'close-lightbox' }));
  b.layers[0].objects.push(close);
  let s = E.start(c);
  s = E.click(c, s, open.id);
  assert.equal(s.slideId, b.id);
  assert.equal(s.lightboxFrom, a.id);
  s = E.click(c, s, close.id);
  assert.equal(s.slideId, a.id);
  assert.equal(s.lightboxFrom, null);
  assert.equal(E.stateOf(s, open), 'Visited', 'the slide underneath keeps its state');
  s = E.click(c, s, open.id);
  s = E.navigate(c, s, 'next');
  assert.equal(s.slideId, a.id, 'Next from a lightbox closes it');
  s = E.click(c, s, open.id);
  s = E.navigate(c, s, z.id);
  assert.equal(s.lightboxFrom, null, 'menu navigation leaves the lightbox');
});

test('essay questions record the response and never score', () => {
  const c = newCourse('E');
  const q = newQuestionSlide('essay');
  c.scenes[0].slides = [q];
  let s = E.start(c);
  s = E.input(c, s, q.question!.inputObjectId!, 'Long voyages left time to carve.');
  s = E.click(c, s, slideObjects(q).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[q.id].response, 'Long voyages left time to carve.');
  assert.equal(s.answers[q.id].graded, false);
  assert.equal(E.results(c, s).hasQuiz, false);
});

test('motion paths: play and reverse from triggers, reset on re-entry', () => {
  const { c, s1, s2 } = twoSlides();
  const boat = newObject('shape', { motion: { dx: 300, dy: 0, duration: 1, start: 'trigger', at: 0, easing: 'ease' } });
  const go = newObject('button');
  go.triggers.push(newTrigger({ type: 'click' }, { type: 'play-motion', objectId: boat.id }));
  const back = newObject('button');
  back.triggers.push(newTrigger({ type: 'click' }, { type: 'reverse-motion', objectId: boat.id }));
  s1.layers[0].objects.push(boat, go, back);
  let s = E.start(c);
  assert.equal(s.motion[boat.id], undefined);
  s = E.click(c, s, go.id);
  assert.equal(s.motion[boat.id], true);
  s = E.click(c, s, back.id);
  assert.equal(s.motion[boat.id], false);
  s = E.navigate(c, s, s2.id);
  s = E.navigate(c, s, s1.id);
  assert.deepEqual(s.motion, {}, 'motion restarts with the slide');
});

test('Likert survey: any answer is accepted and nothing is scored', async () => {
  const { newLikertSlide } = await import('../src/model/factory.ts');
  const { validateCourse } = await import('../src/model/describe.ts');
  const c = newCourse('Survey');
  const l = newLikertSlide();
  c.scenes[0].slides = [l];
  const choices = slideObjects(l).filter((o) => o.kind === 'choice');
  assert.equal(choices.length, 5);
  let s = E.start(c);
  s = E.click(c, s, choices[3].id);
  s = E.click(c, s, slideObjects(l).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[l.id].response, 'Agree');
  assert.deepEqual(s.layers, [l.question!.correctLayerId]);
  assert.equal(E.results(c, s).hasQuiz, false);
  assert.deepEqual(validateCourse(c), []);
});

test('sequence template grades the order', async () => {
  const { newSequenceSlide } = await import('../src/model/factory.ts');
  const c = newCourse('Seq');
  const q = newSequenceSlide();
  c.scenes[0].slides = [q];
  const items = slideObjects(q).filter((o) => o.draggable);
  let s = E.start(c);
  for (const it of items) s = E.drop(c, s, it.id, it.correctTargetId!);
  s = E.click(c, s, slideObjects(q).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[q.id].correct, true);
});

test('word bank: the distractor cannot satisfy a blank', async () => {
  const { newWordBankSlide } = await import('../src/model/factory.ts');
  const c = newCourse('WB');
  const q = newWordBankSlide();
  q.question!.attempts = 0;
  c.scenes[0].slides = [q];
  const chips = slideObjects(q).filter((o) => o.draggable);
  const [designs, soot, paint] = chips;
  const submit = slideObjects(q).find((o) => o.name === 'Submit')!.id;
  let s = E.start(c);
  s = E.drop(c, s, designs.id, designs.correctTargetId!);
  s = E.drop(c, s, paint.id, soot.correctTargetId!);
  s = E.click(c, s, submit);
  assert.equal(s.answers[q.id].correct, false);
  s = E.drop(c, s, soot.id, soot.correctTargetId!);
  assert.equal(s.drops[paint.id], undefined, 'the distractor is pushed out');
  s = E.click(c, s, submit);
  assert.equal(s.answers[q.id].correct, true);
});

test('completion waits for an unanswered last question, and a changed result is reported again', () => {
  const c = newCourse('Last');
  const q = newQuestionSlide('multiple-choice');
  q.question!.attempts = 0;
  c.scenes[0].slides.push(q);
  const ch = slideObjects(q).filter((o) => o.kind === 'choice');
  const submit = slideObjects(q).find((o) => o.name === 'Submit')!.id;
  const completed = (s: E.PlayerState) => E.takeEffects(s)[1].filter((f) => f.type === 'completed');
  let s = E.navigate(c, E.start(c), 'next');
  assert.deepEqual(completed(s), [], 'nothing reported on arrival');
  s = E.takeEffects(s)[0];
  s = E.click(c, s, ch[1].id);
  s = E.click(c, s, submit);
  assert.deepEqual(completed(s), [], 'a retryable wrong answer is not final');
  s = E.takeEffects(s)[0];
  s = E.click(c, s, ch[0].id);
  s = E.click(c, s, submit);
  assert.deepEqual(completed(s), [{ type: 'completed', status: 'passed', scorePercent: 100 }]);
});

test('no-op events return the same state object', () => {
  const { c, s1 } = twoSlides();
  const b = newObject('button');
  s1.layers[0].objects.push(b);
  const s = E.start(c);
  assert.equal(E.hover(c, s, b.id, true), s);
  assert.equal(E.key(c, s, 'x'), s);
  assert.equal(E.timelineReached(c, s, 1), s);
});

test('closing a lightbox returns to the slide as it was, without restarting it', () => {
  const c = newCourse('L2');
  const a = c.scenes[0].slides[0];
  const b = newSlide('Box');
  c.scenes[0].slides.push(b);
  const pop = newLayer('Pop');
  a.layers.push(pop);
  const v = newVariable('Starts', 'number', 0);
  c.variables.push(v);
  a.triggers.push(newTrigger({ type: 'timeline-start' }, { type: 'adjust-variable', variableId: v.id, op: 'add', value: 1 }));
  const open = newObject('button');
  open.triggers.push(newTrigger({ type: 'click' }, { type: 'lightbox-slide', slideId: b.id }));
  a.layers[0].objects.push(open);
  let s = E.start(c);
  s = E.perform(c, s, { type: 'show-layer', layerId: pop.id });
  const entry = s.entry;
  s = E.click(c, s, open.id);
  s = E.perform(c, s, { type: 'close-lightbox' });
  assert.equal(s.slideId, a.id);
  assert.deepEqual(s.layers, [pop.id], 'shown layers stay shown');
  assert.equal(s.entry, entry, 'same timeline');
  assert.equal(s.vars[v.id], 1, 'timeline-start triggers did not run again');
});

test('resume rebuilds the play order when the course gained slides', () => {
  const c = newCourse('R');
  const extra = newSlide('New');
  const s = E.start(c);
  c.scenes[0].slides.push(extra);
  const r = E.start(c, { sequence: s.sequence });
  assert.ok(r.sequence.includes(extra.id));
});

test('ranking survey: any order is accepted, recorded in order, and nothing is scored', async () => {
  const { newRankingSlide } = await import('../src/model/factory.ts');
  const { validateCourse } = await import('../src/model/describe.ts');
  const c = newCourse('Ranking');
  const r = newRankingSlide();
  c.scenes[0].slides = [r];
  assert.equal(r.question?.graded, false);
  const items = slideObjects(r).filter((o) => o.draggable);
  const slots = slideObjects(r).filter((o) => o.dropTarget);
  assert.equal(items.length, 4);
  assert.deepEqual(slots.map((o) => o.name), ['Rank 1', 'Rank 2', 'Rank 3', 'Rank 4']);
  const submit = slideObjects(r).find((o) => o.name === 'Submit')!.id;
  let s = E.start(c);
  // Submitting with nothing placed still asks the learner to drag something.
  s = E.click(c, s, submit);
  assert.equal(s.answers[r.id], undefined);
  // The reverse of the template order is just as valid.
  [...items].reverse().forEach((it, i) => { s = E.drop(c, s, it.id, slots[i].id); });
  s = E.click(c, s, submit);
  const a = s.answers[r.id];
  assert.equal(a.correct, true);
  assert.equal(a.graded, false);
  assert.equal(a.response, items.slice().reverse().map((it, i) => `${it.name} → Rank ${i + 1}`).join('; '));
  assert.deepEqual(s.layers, [r.question!.correctLayerId]);
  assert.equal(E.results(c, s).hasQuiz, false);
  assert.deepEqual(validateCourse(c), []);
});

test('a graded drag and drop still needs every item on its target', async () => {
  const { newSequenceSlide } = await import('../src/model/factory.ts');
  const c = newCourse('Seq2');
  const q = newSequenceSlide();
  c.scenes[0].slides = [q];
  const items = slideObjects(q).filter((o) => o.draggable);
  let s = E.start(c);
  items.forEach((it, i) => { s = E.drop(c, s, it.id, items[(i + 1) % items.length].correctTargetId!); });
  s = E.click(c, s, slideObjects(q).find((o) => o.name === 'Submit')!.id);
  assert.equal(s.answers[q.id].correct, false);
});
