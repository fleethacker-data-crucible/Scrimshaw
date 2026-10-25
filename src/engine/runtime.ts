// The Scrimshaw player engine. Pure functions over (course, state): no DOM, no timers, so it is
// unit-tested in Node and shared by the editor preview and every published package.
//
// Behaviour follows Storyline's model:
//  - triggers run top to bottom in slide → layer → object order; a navigation action stops the rest;
//  - an object's "Visited" state applies after its click triggers run, so a trigger can test
//    "state is not Visited" to count first clicks;
//  - showing a layer with hideOthers hides other layers; the base layer is always visible;
//  - slide object states are saved when leaving a slide and restored on return ("resume saved state").
import { allSlides, findLayer, findObject, findSlide, sceneOfSlide, slideIndex, slideObjects, startSlide } from '../model/query.ts';
import type { Action, Condition, ConditionOp, Course, ID, Slide, SlideObject, Trigger, TriggerEvent, Value } from '../model/types.ts';

export interface Answer {
  correct: boolean;
  points: number;
  max: number;
  response: string;
  graded: boolean;
  /** No attempts left (or answered correctly): further submits re-show feedback without regrading. */
  final: boolean;
}

export type Effect =
  | { type: 'open-url'; url: string }
  | { type: 'exit' }
  | { type: 'media'; objectId: ID; op: 'play' | 'pause' }
  | { type: 'timeline'; op: 'pause' | 'resume' }
  | { type: 'slide-entered'; slideId: ID }
  | { type: 'notice'; message: string }
  | { type: 'completed'; status: 'passed' | 'failed' | 'completed'; scorePercent: number | null };

export interface PlayerState {
  slideId: ID;
  /** Visible non-base layers on the current slide, in the order they were shown. */
  layers: ID[];
  vars: Record<ID, Value>;
  /** Current state name of each object on the current slide that is not "Normal". */
  states: Record<ID, string>;
  /** Text typed into input objects on the current slide. */
  inputs: Record<ID, string>;
  visited: Record<ID, true>;
  visitedSlides: Record<ID, true>;
  /** Object states saved per slide when the learner leaves it. */
  saved: Record<ID, { states: Record<ID, string>; inputs: Record<ID, string> }>;
  answers: Record<ID, Answer>;
  attempts: Record<ID, number>;
  history: ID[];
  completed: boolean;
  /** Increments on every slide entry, so the UI can restart the slide timeline. */
  entry: number;
  effects: Effect[];
}

const MAX_DEPTH = 12;

// ---------- values ----------

export function initialVars(course: Course): Record<ID, Value> {
  const vars: Record<ID, Value> = {};
  for (const v of course.variables) vars[v.id] = v.initial;
  return vars;
}

export function results(course: Course, s: Pick<PlayerState, 'answers'>) {
  let max = 0;
  let points = 0;
  let answered = 0;
  let correct = 0;
  for (const sl of allSlides(course)) {
    const q = sl.question;
    if (!q || !q.graded) continue;
    max += q.points;
    const a = s.answers[sl.id];
    if (a) {
      answered++;
      if (a.correct) { correct++; points += a.points; }
    }
  }
  const percent = max > 0 ? Math.round((points / max) * 100) : 0;
  return { points, max, percent, passed: max > 0 ? percent >= course.quiz.passPercent : true, answered, correct, hasQuiz: max > 0 };
}

/** Value of a user variable (by id) or a built-in (by name, e.g. "Results.ScorePercent"). */
export function readVar(course: Course, s: PlayerState, key: ID): Value | undefined {
  if (key in s.vars) return s.vars[key];
  if (key.startsWith('Results.')) {
    const r = results(course, s);
    switch (key) {
      case 'Results.ScorePoints': return r.points;
      case 'Results.MaxPoints': return r.max;
      case 'Results.ScorePercent': return r.percent;
      case 'Results.PassPercent': return course.quiz.passPercent;
      case 'Results.Passed': return r.passed;
      case 'Results.Answered': return r.answered;
      case 'Results.Correct': return r.correct;
    }
  }
  if (key.startsWith('Project.')) {
    const slides = allSlides(course);
    const i = slides.findIndex((x) => x.id === s.slideId);
    switch (key) {
      case 'Project.SlideNumber': return i + 1;
      case 'Project.TotalSlides': return slides.length;
      case 'Project.SlideTitle': return slides[i]?.title ?? '';
      case 'Project.CourseTitle': return course.title;
    }
  }
  return undefined;
}

export function formatValue(v: Value | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
}

/** Replaces %Name% with variable values. Unknown names are left as typed. */
export function interpolate(text: string, course: Course, s: PlayerState): string {
  if (!text.includes('%')) return text;
  return text.replace(/%([A-Za-z_][\w.]*)%/g, (m, name: string) => {
    const v = course.variables.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const val = v ? s.vars[v.id] : readVar(course, s, name);
    return val === undefined ? m : formatValue(val);
  });
}

const isNumeric = (v: Value) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
const lower = (v: Value) => String(v).trim().toLowerCase();

export function compare(left: Value | undefined, op: ConditionOp, right: Value): boolean {
  const l: Value = left ?? '';
  switch (op) {
    case 'empty': return lower(l) === '' || l === false;
    case 'not-empty': return !(lower(l) === '' || l === false);
    case 'contains': return lower(l).includes(lower(right));
    case 'not-contains': return !lower(l).includes(lower(right));
  }
  if (typeof l === 'boolean' || typeof right === 'boolean') {
    const lb = typeof l === 'boolean' ? l : lower(l) === 'true';
    const rb = typeof right === 'boolean' ? right : lower(right) === 'true';
    return op === '==' ? lb === rb : op === '!=' ? lb !== rb : false;
  }
  if (isNumeric(l) && isNumeric(right)) {
    const a = Number(l);
    const b = Number(right);
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
    }
  }
  const a = lower(l);
  const b = lower(right);
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
  return false;
}

export function stateOf(s: PlayerState, o: SlideObject): string {
  return s.states[o.id] ?? 'Normal';
}

export function isVisible(s: PlayerState, o: SlideObject): boolean {
  return stateOf(s, o) !== 'Hidden';
}

function conditionHolds(course: Course, s: PlayerState, c: Condition, self: SlideObject | null): boolean {
  if (c.kind === 'variable') {
    const right = c.compareVariableId ? readVar(course, s, c.compareVariableId) ?? '' : c.value;
    return compare(readVar(course, s, c.variableId), c.op, right);
  }
  const slide = findSlide(course, s.slideId);
  const obj = c.objectId === 'this' ? self : slide ? findObject(slide, c.objectId) : undefined;
  if (!obj) return false;
  const st = stateOf(s, obj);
  // "Visited" is also true when the object is in a later state after being visited.
  const matches = c.state === 'Visited' ? st === 'Visited' || !!s.visited[obj.id] : st === c.state;
  return c.is ? matches : !matches;
}

export function triggerApplies(course: Course, s: PlayerState, t: Trigger, self: SlideObject | null): boolean {
  if (!t.enabled) return false;
  if (t.conditions.length === 0) return true;
  const results = t.conditions.map((c) => conditionHolds(course, s, c, self));
  return t.join === 'or' ? results.some(Boolean) : results.every(Boolean);
}

// ---------- state helpers ----------

function clone(s: PlayerState): PlayerState {
  return {
    ...s,
    layers: [...s.layers], vars: { ...s.vars }, states: { ...s.states }, inputs: { ...s.inputs },
    visited: { ...s.visited }, visitedSlides: { ...s.visitedSlides }, saved: { ...s.saved },
    answers: { ...s.answers }, attempts: { ...s.attempts }, history: [...s.history], effects: [...s.effects],
  };
}

function eventMatches(a: TriggerEvent, b: TriggerEvent): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'variable-change': return a.variableId === (b as typeof a).variableId;
    case 'key': return a.key.toLowerCase() === (b as typeof a).key.toLowerCase();
    case 'state-change': return a.objectId === (b as typeof a).objectId && a.state === (b as typeof a).state;
    case 'timeline-reaches': return Math.abs(a.time - (b as typeof a).time) < 1e-6;
    default: return true;
  }
}

interface Ctx {
  course: Course;
  s: PlayerState;
  depth: number;
  /** Set when an action navigates away; stops the remaining triggers. */
  navigated: boolean;
}

function currentSlide(ctx: Ctx): Slide {
  const sl = findSlide(ctx.course, ctx.s.slideId);
  if (!sl) throw new Error(`Slide ${ctx.s.slideId} not found`);
  return sl;
}

/** Runs every matching trigger. scope: which triggers are eligible. */
function fire(ctx: Ctx, event: TriggerEvent, scope: { objectId?: ID; layerId?: ID; slideLevel?: boolean; anywhere?: boolean }) {
  if (ctx.depth > MAX_DEPTH || ctx.navigated) return;
  ctx.depth++;
  const slide = currentSlide(ctx);
  const visibleLayers = new Set([slide.layers[0].id, ...ctx.s.layers]);
  const candidates: { t: Trigger; layerId: ID | null; self: SlideObject | null }[] = [];
  if (scope.slideLevel || scope.anywhere) for (const t of slide.triggers) candidates.push({ t, layerId: null, self: null });
  for (const l of slide.layers) {
    if ((scope.layerId === l.id) || (scope.anywhere && visibleLayers.has(l.id))) for (const t of l.triggers) candidates.push({ t, layerId: l.id, self: null });
    for (const o of l.objects) {
      if (scope.objectId === o.id || (scope.anywhere && visibleLayers.has(l.id))) for (const t of o.triggers) candidates.push({ t, layerId: l.id, self: o });
    }
  }
  const startSlideId = ctx.s.slideId;
  const startEntry = ctx.s.entry;
  for (const { t, layerId, self } of candidates) {
    if (ctx.navigated || ctx.s.slideId !== startSlideId || ctx.s.entry !== startEntry) break;
    if (!eventMatches(t.event, event)) continue;
    if (!triggerApplies(ctx.course, ctx.s, t, self)) continue;
    run(ctx, t.action, { layerId, self });
  }
  ctx.depth--;
}

function setVar(ctx: Ctx, id: ID, value: Value) {
  const v = ctx.course.variables.find((x) => x.id === id);
  if (!v) return;
  let next: Value = value;
  if (v.type === 'number') next = Number.isFinite(Number(value)) ? Number(value) : 0;
  else if (v.type === 'boolean') next = typeof value === 'boolean' ? value : lower(value) === 'true';
  else next = String(value);
  if (ctx.s.vars[id] === next) return;
  ctx.s.vars[id] = next;
  fire(ctx, { type: 'variable-change', variableId: id }, { anywhere: true });
}

function setObjectState(ctx: Ctx, obj: SlideObject, state: string) {
  const prev = stateOf(ctx.s, obj);
  if (prev === state) return;
  if (state === 'Normal') delete ctx.s.states[obj.id];
  else ctx.s.states[obj.id] = state;
  if (state === 'Visited') ctx.s.visited[obj.id] = true;
  fire(ctx, { type: 'state-change', objectId: obj.id, state }, { anywhere: true });
}

function showLayer(ctx: Ctx, layerId: ID) {
  const slide = currentSlide(ctx);
  const layer = findLayer(slide, layerId);
  if (!layer || layer.base) return;
  if (layer.hideOthers) ctx.s.layers = ctx.s.layers.filter((id) => id === layerId);
  ctx.s.layers = [...ctx.s.layers.filter((id) => id !== layerId), layerId];
  fire(ctx, { type: 'timeline-start' }, { layerId });
}

function hideLayer(ctx: Ctx, layerId: ID) {
  ctx.s.layers = ctx.s.layers.filter((id) => id !== layerId);
}

function enter(ctx: Ctx, slideId: ID, opts: { pushHistory: boolean }) {
  const target = findSlide(ctx.course, slideId);
  if (!target) return;
  const s = ctx.s;
  // Save the slide being left.
  if (s.slideId) s.saved[s.slideId] = { states: { ...s.states }, inputs: { ...s.inputs } };
  if (opts.pushHistory && s.slideId && s.slideId !== slideId) s.history.push(s.slideId);
  s.slideId = slideId;
  s.layers = [];
  s.entry++;
  const restored = s.saved[slideId];
  if (restored && ctx.course.player.resume) {
    s.states = { ...restored.states };
    s.inputs = { ...restored.inputs };
  } else {
    s.states = {};
    s.inputs = {};
    for (const o of slideObjects(target)) if (o.initiallyHidden) s.states[o.id] = 'Hidden';
  }
  s.visitedSlides[slideId] = true;
  s.effects.push({ type: 'slide-entered', slideId });
  ctx.navigated = true;
  checkCompletion(ctx);
  // A fresh context so the new slide's timeline-start triggers run.
  const inner: Ctx = { course: ctx.course, s, depth: ctx.depth, navigated: false };
  fire(inner, { type: 'timeline-start' }, { slideLevel: true, layerId: target.layers[0].id });
}

function checkCompletion(ctx: Ctx) {
  const { course, s } = ctx;
  if (s.completed) return;
  const slides = allSlides(course);
  const target = course.quiz.completionSlideId ?? slides[slides.length - 1]?.id;
  if (s.slideId !== target) return;
  s.completed = true;
  const r = results(course, s);
  const status = course.quiz.reporting === 'passed-failed' && r.hasQuiz ? (r.passed ? 'passed' : 'failed') : 'completed';
  s.effects.push({ type: 'completed', status, scorePercent: r.hasQuiz ? r.percent : null });
}

function submit(ctx: Ctx) {
  const slide = currentSlide(ctx);
  const q = slide.question;
  if (!q) return;
  const prev = ctx.s.answers[slide.id];
  const feedback = (correct: boolean, retry: boolean) => {
    const layerId = correct ? q.correctLayerId : retry ? (q.tryAgainLayerId ?? q.incorrectLayerId) : q.incorrectLayerId;
    if (layerId && findLayer(slide, layerId)) showLayer(ctx, layerId);
    else if (!retry) nextSlide(ctx);
  };
  if (prev?.final) { feedback(prev.correct, false); return; }

  let correct = false;
  let response = '';
  if (q.kind === 'fill-in') {
    const inputId = q.inputObjectId;
    const input = inputId ? findObject(slide, inputId) : undefined;
    response = inputId ? (ctx.s.inputs[inputId] ?? '') : '';
    if (!response && input?.variableId) response = formatValue(ctx.s.vars[input.variableId]);
    if (response.trim() === '') { ctx.s.effects.push({ type: 'notice', message: 'Type an answer before you submit.' }); return; }
    correct = q.accepted.some((a) => lower(a) === lower(response));
  } else {
    const choices = slideObjects(slide).filter((o) => o.kind === 'choice');
    const selected = choices.filter((o) => stateOf(ctx.s, o) === 'Selected');
    if (selected.length === 0) { ctx.s.effects.push({ type: 'notice', message: 'Choose an answer before you submit.' }); return; }
    response = selected.map((o) => o.text).join('; ');
    correct = choices.every((o) => (stateOf(ctx.s, o) === 'Selected') === o.correct);
  }
  const attempt = (ctx.s.attempts[slide.id] ?? 0) + 1;
  ctx.s.attempts[slide.id] = attempt;
  const outOfAttempts = q.attempts > 0 && attempt >= q.attempts;
  const final = correct || outOfAttempts;
  ctx.s.answers[slide.id] = { correct, points: correct ? q.points : 0, max: q.points, response, graded: q.graded, final };
  if (final) for (const o of slideObjects(slide)) if (o.kind === 'choice' || o.kind === 'input') {
    if (stateOf(ctx.s, o) !== 'Selected') setObjectState(ctx, o, 'Disabled');
  }
  feedback(correct, !final);
}

function nextSlide(ctx: Ctx) {
  const slides = allSlides(ctx.course);
  const i = slides.findIndex((x) => x.id === ctx.s.slideId);
  if (i >= 0 && i < slides.length - 1) enter(ctx, slides[i + 1].id, { pushHistory: true });
}

function prevSlide(ctx: Ctx) {
  const back = ctx.s.history.pop();
  if (back && findSlide(ctx.course, back)) { enter(ctx, back, { pushHistory: false }); return; }
  const slides = allSlides(ctx.course);
  const i = slides.findIndex((x) => x.id === ctx.s.slideId);
  if (i > 0) enter(ctx, slides[i - 1].id, { pushHistory: false });
}

function run(ctx: Ctx, a: Action, where: { layerId: ID | null; self: SlideObject | null }) {
  const slide = currentSlide(ctx);
  switch (a.type) {
    case 'jump-slide': if (findSlide(ctx.course, a.slideId)) enter(ctx, a.slideId, { pushHistory: true }); break;
    case 'next-slide': nextSlide(ctx); break;
    case 'prev-slide': prevSlide(ctx); break;
    case 'jump-scene': {
      const sc = ctx.course.scenes.find((x) => x.id === a.sceneId);
      if (sc?.slides[0]) enter(ctx, sc.slides[0].id, { pushHistory: true });
      break;
    }
    case 'show-layer': showLayer(ctx, a.layerId); break;
    case 'hide-layer': {
      const id = a.layerId === 'this' ? where.layerId : a.layerId;
      if (id) hideLayer(ctx, id);
      break;
    }
    case 'set-state': {
      const obj = a.objectId === 'this' ? where.self : findObject(slide, a.objectId);
      if (obj) setObjectState(ctx, obj, a.state);
      break;
    }
    case 'adjust-variable': {
      const v = ctx.course.variables.find((x) => x.id === a.variableId);
      if (!v) break;
      const cur = ctx.s.vars[v.id] ?? v.initial;
      const operand: Value = a.fromVariableId ? (readVar(ctx.course, ctx.s, a.fromVariableId) ?? '') : a.value;
      let next: Value = operand;
      const n = Number(cur) || 0;
      const m = Number(operand) || 0;
      switch (a.op) {
        case 'set': case 'assign': next = operand; break;
        case 'add': next = v.type === 'text' ? String(cur) + String(operand) : n + m; break;
        case 'subtract': next = n - m; break;
        case 'multiply': next = n * m; break;
        case 'divide': next = m === 0 ? n : n / m; break;
        case 'toggle': next = !(cur === true || lower(cur) === 'true'); break;
      }
      setVar(ctx, v.id, next);
      break;
    }
    case 'submit-interaction': submit(ctx); break;
    case 'reset-results': {
      let first: ID | null = null;
      for (const sl of allSlides(ctx.course)) if (sl.question) {
        first ??= sl.id;
        delete ctx.s.answers[sl.id];
        delete ctx.s.attempts[sl.id];
        delete ctx.s.saved[sl.id];
      }
      ctx.s.completed = false;
      if (first) enter(ctx, first, { pushHistory: true });
      break;
    }
    case 'open-url': if (/^(https?:|mailto:)/i.test(a.url.trim())) ctx.s.effects.push({ type: 'open-url', url: a.url.trim() }); break;
    case 'play-media': ctx.s.effects.push({ type: 'media', objectId: a.objectId, op: 'play' }); break;
    case 'pause-media': ctx.s.effects.push({ type: 'media', objectId: a.objectId, op: 'pause' }); break;
    case 'pause-timeline': ctx.s.effects.push({ type: 'timeline', op: 'pause' }); break;
    case 'resume-timeline': ctx.s.effects.push({ type: 'timeline', op: 'resume' }); break;
    case 'restart-course': {
      const fresh = start(ctx.course);
      Object.assign(ctx.s, fresh, { entry: ctx.s.entry + 1 });
      ctx.navigated = true;
      break;
    }
    case 'exit-course': ctx.s.effects.push({ type: 'exit' }); ctx.navigated = true; break;
  }
}

// ---------- public API (each returns a new state) ----------

export function start(course: Course, resume?: Partial<Pick<PlayerState, 'slideId' | 'vars' | 'answers' | 'attempts' | 'visited' | 'visitedSlides' | 'saved'>>): PlayerState {
  const first = startSlide(course);
  if (!first) throw new Error('The course has no slides.');
  const s: PlayerState = {
    slideId: first.id, layers: [], vars: initialVars(course), states: {}, inputs: {}, visited: {}, visitedSlides: {},
    saved: {}, answers: {}, attempts: {}, history: [], completed: false, entry: 0, effects: [],
  };
  if (resume) {
    Object.assign(s.vars, resume.vars ?? {});
    Object.assign(s.answers, resume.answers ?? {});
    Object.assign(s.attempts, resume.attempts ?? {});
    Object.assign(s.visited, resume.visited ?? {});
    Object.assign(s.visitedSlides, resume.visitedSlides ?? {});
    Object.assign(s.saved, resume.saved ?? {});
  }
  const target = resume?.slideId && findSlide(course, resume.slideId) ? resume.slideId : first.id;
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  s.slideId = ''; // nothing to save on the way in
  enter(ctx, target, { pushHistory: false });
  return s;
}

/** Learner clicked an object (pointer or keyboard). */
export function click(course: Course, state: PlayerState, objectId: ID): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  const slide = currentSlide(ctx);
  const obj = findObject(slide, objectId);
  if (!obj || !isVisible(s, obj) || stateOf(s, obj) === 'Disabled') return state;
  if (obj.kind === 'choice') {
    const selected = stateOf(s, obj) === 'Selected';
    if (obj.choiceMode === 'radio') {
      if (!selected) {
        for (const o of slideObjects(slide)) if (o.kind === 'choice' && o.choiceMode === 'radio' && o.id !== obj.id && stateOf(s, o) === 'Selected') setObjectState(ctx, o, 'Normal');
        setObjectState(ctx, obj, 'Selected');
      }
    } else setObjectState(ctx, obj, selected ? 'Normal' : 'Selected');
  }
  fire(ctx, { type: 'click' }, { objectId });
  if (ctx.s.slideId === slide.id && !ctx.navigated) {
    s.visited[obj.id] = true;
    if (obj.states.some((x) => x.name === 'Visited') && stateOf(s, obj) === 'Normal') setObjectState(ctx, obj, 'Visited');
  } else s.visited[obj.id] = true;
  return s;
}

export function hover(course: Course, state: PlayerState, objectId: ID, entering: boolean): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  fire(ctx, { type: entering ? 'hover-enter' : 'hover-leave' }, { objectId });
  return s;
}

/** Learner typed into an input object. Writes its variable and fires variable-change triggers. */
export function input(course: Course, state: PlayerState, objectId: ID, text: string): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  const obj = findObject(currentSlide(ctx), objectId);
  if (!obj) return state;
  s.inputs[objectId] = text;
  if (obj.variableId) setVar(ctx, obj.variableId, text);
  return s;
}

export function key(course: Course, state: PlayerState, keyName: string): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  fire(ctx, { type: 'key', key: keyName }, { anywhere: true });
  return s;
}

/** The slide's timeline (or a layer's) passed a time mark. */
export function timelineReached(course: Course, state: PlayerState, time: number, layerId?: ID): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  const slide = currentSlide(ctx);
  fire(ctx, { type: 'timeline-reaches', time }, layerId ? { layerId } : { slideLevel: true, layerId: slide.layers[0].id });
  return s;
}

/** The slide's timeline (or a layer's) ended. Auto-advances when the slide is set to. */
export function timelineEnded(course: Course, state: PlayerState, layerId?: ID): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  const slide = currentSlide(ctx);
  if (layerId) { fire(ctx, { type: 'timeline-end' }, { layerId }); return s; }
  fire(ctx, { type: 'timeline-end' }, { slideLevel: true, layerId: slide.layers[0].id });
  if (!ctx.navigated && s.slideId === slide.id && slide.advance === 'auto' && !slide.question && s.layers.length === 0) nextSlide(ctx);
  return s;
}

/** Player chrome: Next / Prev / menu jump. */
export function navigate(course: Course, state: PlayerState, to: 'next' | 'prev' | ID): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  if (to === 'next') nextSlide(ctx);
  else if (to === 'prev') prevSlide(ctx);
  else if (findSlide(course, to)) enter(ctx, to, { pushHistory: true });
  return s;
}

/** Runs one action as if a trigger fired it (used by the player for built-in buttons). */
export function perform(course: Course, state: PlayerState, action: Action): PlayerState {
  const s = clone(state);
  const ctx: Ctx = { course, s, depth: 0, navigated: false };
  run(ctx, action, { layerId: null, self: null });
  return s;
}

export function takeEffects(state: PlayerState): [PlayerState, Effect[]] {
  if (state.effects.length === 0) return [state, []];
  return [{ ...state, effects: [] }, state.effects];
}

export function canGoNext(course: Course, s: PlayerState): boolean {
  const slides = allSlides(course);
  const i = slideIndex(course, s.slideId);
  const slide = slides[i];
  if (!slide || i >= slides.length - 1) return false;
  if (slide.question && !s.answers[slide.id]) return false;
  return true;
}

export function canGoPrev(course: Course, s: PlayerState): boolean {
  return s.history.length > 0 || slideIndex(course, s.slideId) > 0;
}

export function canOpenFromMenu(course: Course, s: PlayerState, slideId: ID): boolean {
  return course.player.navigation === 'free' || !!s.visitedSlides[slideId];
}

/** Compact snapshot for SCORM suspend_data (4096 chars in SCORM 1.2). */
export function suspend(s: PlayerState): string {
  const answers: Record<ID, [number, number, number]> = {};
  for (const [k, a] of Object.entries(s.answers)) answers[k] = [a.correct ? 1 : 0, a.points, a.final ? 1 : 0];
  return JSON.stringify({ v: 1, s: s.slideId, vars: s.vars, a: answers, t: s.attempts, vs: Object.keys(s.visitedSlides) });
}

export function resumeFrom(course: Course, data: string): PlayerState | null {
  try {
    const j = JSON.parse(data) as { v: number; s: ID; vars: Record<ID, Value>; a: Record<ID, [number, number, number]>; t: Record<ID, number>; vs: ID[] };
    if (j.v !== 1) return null;
    const answers: Record<ID, Answer> = {};
    for (const [k, [c, p, f]] of Object.entries(j.a ?? {})) {
      const sl = findSlide(course, k);
      if (!sl?.question) continue;
      answers[k] = { correct: !!c, points: p, max: sl.question.points, response: '', graded: sl.question.graded, final: !!f };
    }
    const visitedSlides: Record<ID, true> = {};
    for (const id of j.vs ?? []) visitedSlides[id] = true;
    return start(course, { slideId: j.s, vars: j.vars, answers, attempts: j.t, visitedSlides });
  } catch {
    return null;
  }
}

export { sceneOfSlide };
