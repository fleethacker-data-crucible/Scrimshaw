// Loading and validation for course JSON from untrusted places (files, IndexedDB, packages).
// normalizeCourse() fills any missing field with its default so older or hand-written files load,
// and rejects anything that is not recognisably a Scrimshaw course.
import { baseStyle, newCourse, newLayer, newObject, newSlide } from './factory.ts';
import { SCHEMA_VERSION, type Course, type Layer, type Slide, type SlideObject, type Trigger } from './types.ts';

export class CourseFormatError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = <T>(v: unknown, map: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.map(map).filter((x): x is T => x !== null) : [];
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d);

const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isValue = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const OPS = ['==', '!=', '<', '<=', '>', '>=', 'contains', 'not-contains', 'empty', 'not-empty'];
const VAR_OPS = ['set', 'add', 'subtract', 'multiply', 'divide', 'toggle', 'assign'];

/** Each event type with the fields it needs; anything malformed is dropped. */
function event(v: Record<string, unknown>): Trigger['event'] | null {
  switch (v.type) {
    case 'click': case 'hover-enter': case 'hover-leave': case 'timeline-start': case 'timeline-end': return { type: v.type };
    case 'timeline-reaches': return typeof v.time === 'number' && Number.isFinite(v.time) ? { type: v.type, time: Math.max(0, v.time) } : null;
    case 'variable-change': return id(v.variableId) ? { type: v.type, variableId: v.variableId } : null;
    case 'key': return id(v.key) ? { type: v.type, key: v.key } : null;
    case 'state-change': return id(v.objectId) && id(v.state) ? { type: v.type, objectId: v.objectId, state: v.state } : null;
    case 'drop': return id(v.targetId) ? { type: v.type, targetId: v.targetId } : null;
  }
  return null;
}

function action(v: Record<string, unknown>): Trigger['action'] | null {
  switch (v.type) {
    case 'next-slide': case 'prev-slide': case 'close-lightbox': case 'submit-interaction': case 'reset-results':
    case 'pause-timeline': case 'resume-timeline': case 'restart-course': case 'exit-course':
      return { type: v.type };
    case 'jump-slide': case 'lightbox-slide': return id(v.slideId) ? { type: v.type, slideId: v.slideId } : null;
    case 'jump-scene': return id(v.sceneId) ? { type: v.type, sceneId: v.sceneId } : null;
    case 'show-layer': return id(v.layerId) ? { type: v.type, layerId: v.layerId } : null;
    case 'hide-layer': return id(v.layerId) ? { type: v.type, layerId: v.layerId } : null;
    case 'set-state': return id(v.objectId) && id(v.state) ? { type: v.type, objectId: v.objectId, state: v.state } : null;
    case 'play-media': case 'pause-media': return id(v.objectId) ? { type: v.type, objectId: v.objectId } : null;
    case 'play-motion': case 'reverse-motion': return id(v.objectId) ? { type: v.type, objectId: v.objectId } : null;
    case 'open-url': return typeof v.url === 'string' ? { type: v.type, url: v.url } : null;
    case 'adjust-variable':
      if (!id(v.variableId) || typeof v.op !== 'string' || !VAR_OPS.includes(v.op) || !isValue(v.value)) return null;
      return { type: v.type, variableId: v.variableId, op: v.op as 'set', value: v.value, ...(id(v.fromVariableId) ? { fromVariableId: v.fromVariableId } : {}) };
  }
  return null;
}

function condition(v: unknown): Trigger['conditions'][number] | null {
  if (!isObj(v)) return null;
  if (v.kind === 'variable' && id(v.variableId) && typeof v.op === 'string' && OPS.includes(v.op)) {
    return { kind: 'variable', variableId: v.variableId, op: v.op as '==', value: isValue(v.value) ? v.value : '', ...(id(v.compareVariableId) ? { compareVariableId: v.compareVariableId } : {}) };
  }
  if (v.kind === 'state' && id(v.objectId) && id(v.state)) return { kind: 'state', objectId: v.objectId, is: bool(v.is, true), state: v.state };
  return null;
}

function trigger(v: unknown): Trigger | null {
  if (!isObj(v) || !id(v.id) || !isObj(v.event) || !isObj(v.action)) return null;
  const ev = event(v.event);
  const ac = action(v.action);
  if (!ev || !ac) return null;
  return { id: v.id, event: ev, action: ac, conditions: arr(v.conditions, condition), join: v.join === 'or' ? 'or' : 'and', enabled: bool(v.enabled, true) };
}

const STYLE_NUM = ['strokeWidth', 'radius', 'fontSize', 'fontWeight', 'padding', 'opacity', 'lineHeight'] as const;
const STYLE_STR = ['fill', 'stroke', 'color'] as const;
/** Keeps only well-typed style fields (partial for states, complete for objects). */
function stylePart(v: unknown): Partial<SlideObject['style']> {
  if (!isObj(v)) return {};
  const out: Partial<SlideObject['style']> = {};
  for (const k of STYLE_NUM) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k] as number;
  for (const k of STYLE_STR) if (typeof v[k] === 'string') out[k] = v[k] as string;
  if (v.fontFamily === 'sans' || v.fontFamily === 'mono') out.fontFamily = v.fontFamily;
  if (typeof v.italic === 'boolean') out.italic = v.italic;
  if (typeof v.underline === 'boolean') out.underline = v.underline;
  if (typeof v.shadow === 'boolean') out.shadow = v.shadow;
  if (v.align === 'left' || v.align === 'center' || v.align === 'right') out.align = v.align;
  if (v.valign === 'top' || v.valign === 'middle' || v.valign === 'bottom') out.valign = v.valign;
  return out;
}

const ANIMS = ['none', 'fade', 'fly-left', 'fly-right', 'fly-up', 'fly-down', 'zoom', 'wipe'];
function anim(v: unknown, d: SlideObject['enter']): SlideObject['enter'] {
  if (!isObj(v) || typeof v.type !== 'string' || !ANIMS.includes(v.type)) return d;
  return { type: v.type as SlideObject['enter']['type'], duration: Math.max(0.05, num(v.duration, d.duration)) };
}

const QUESTION_KINDS = ['multiple-choice', 'multiple-response', 'true-false', 'fill-in', 'drag-drop', 'hotspot', 'numeric', 'essay'];
function question(v: unknown): Slide['question'] {
  if (!isObj(v) || typeof v.kind !== 'string' || !QUESTION_KINDS.includes(v.kind)) return null;
  const id = (x: unknown) => (typeof x === 'string' ? x : null);
  return {
    kind: v.kind as NonNullable<Slide['question']>['kind'],
    points: Math.max(0, num(v.points, 10)),
    attempts: Math.max(0, Math.floor(num(v.attempts, 1))),
    graded: bool(v.graded, true),
    shuffle: bool(v.shuffle),
    numMin: num(v.numMin, 0),
    numMax: num(v.numMax, num(v.numMin, 0)),
    accepted: Array.isArray(v.accepted) ? v.accepted.filter((a): a is string => typeof a === 'string') : [],
    inputObjectId: id(v.inputObjectId),
    correctLayerId: id(v.correctLayerId),
    incorrectLayerId: id(v.incorrectLayerId),
    tryAgainLayerId: id(v.tryAgainLayerId),
  };
}

const SHAPES = ['rect', 'round', 'ellipse', 'triangle', 'arrow', 'line'];
function object(v: unknown): SlideObject | null {
  if (!isObj(v) || !id(v.id) || typeof v.kind !== 'string') return null;
  const kinds = ['text', 'shape', 'image', 'button', 'hotspot', 'input', 'choice', 'video', 'audio', 'slider'];
  if (!kinds.includes(v.kind)) return null;
  const d = newObject(v.kind as SlideObject['kind']);
  const strOr = (k: keyof SlideObject) => str(v[k], d[k] as string);
  return {
    ...d,
    id: v.id,
    name: strOr('name'), text: strOr('text'), src: strOr('src'), alt: strOr('alt'),
    shape: typeof v.shape === 'string' && SHAPES.includes(v.shape) ? (v.shape as SlideObject['shape']) : d.shape,
    style: { ...baseStyle(), ...d.style, ...stylePart(v.style) },
    motion: isObj(v.motion) ? {
      dx: num(v.motion.dx), dy: num(v.motion.dy), duration: Math.max(0.05, num(v.motion.duration, 1)),
      start: v.motion.start === 'trigger' ? 'trigger' : 'timeline', at: Math.max(0, num(v.motion.at)),
      easing: v.motion.easing === 'linear' ? 'linear' : 'ease',
    } : null,
    enter: anim(v.enter, d.enter),
    exit: anim(v.exit, d.exit),
    states: arr(v.states, (s) => (isObj(s) && id(s.id) && id(s.name)
      ? { id: s.id, name: s.name, style: stylePart(s.style), text: typeof s.text === 'string' ? s.text : null }
      : null)),
    triggers: arr(v.triggers, trigger),
    x: num(v.x, d.x), y: num(v.y, d.y), w: Math.max(1, num(v.w, d.w)), h: Math.max(1, num(v.h, d.h)),
    rotation: num(v.rotation), start: Math.max(0, num(v.start)),
    end: typeof v.end === 'number' && Number.isFinite(v.end) ? v.end : null,
    decorative: bool(v.decorative), initiallyHidden: bool(v.initiallyHidden),
    variableId: id(v.variableId) ? v.variableId : null,
    min: num(v.min, d.min), max: num(v.max, d.max), step: num(v.step, d.step) > 0 ? num(v.step, d.step) : d.step,
    correct: bool(v.correct), choiceMode: v.choiceMode === 'check' ? 'check' : 'radio',
    autoplay: bool(v.autoplay, d.autoplay), controls: bool(v.controls, d.controls), loop: bool(v.loop),
    locked: bool(v.locked), editorHidden: bool(v.editorHidden),
    draggable: bool(v.draggable), dropTarget: bool(v.dropTarget),
    groupId: id(v.groupId) ? v.groupId : null,
    multiline: bool(v.multiline),
    captions: str(v.captions),
    correctTargetId: id(v.correctTargetId) ? v.correctTargetId : null,
  };
}

function layer(v: unknown, i: number): Layer | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const d = newLayer(str(v.name, i === 0 ? 'Base layer' : 'Layer'), i === 0);
  return {
    ...d, id: v.id, name: str(v.name, d.name), base: i === 0,
    hideOthers: bool(v.hideOthers, true), modal: bool(v.modal),
    objects: arr(v.objects, object), triggers: arr(v.triggers, trigger),
  };
}

function slide(v: unknown): Slide | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const d = newSlide();
  const layers = Array.isArray(v.layers) ? v.layers.map(layer).filter((l): l is Layer => l !== null) : [];
  if (layers.length === 0) layers.push(d.layers[0]);
  layers[0].base = true;
  return {
    id: v.id, title: str(v.title, 'Untitled slide'), notes: str(v.notes), background: str(v.background, '#ffffff'),
    duration: Math.max(0.5, num(v.duration, 5)), advance: v.advance === 'auto' ? 'auto' : 'user',
    layers, triggers: arr(v.triggers, trigger),
    question: question(v.question),
    inMenu: bool(v.inMenu, true),
    useMaster: bool(v.useMaster, true),
  };
}

function playerSettings(v: unknown, d: Course['player']): Course['player'] {
  const p = isObj(v) ? v : {};
  return {
    ...d,
    showMenu: bool(p.showMenu, d.showMenu), showNav: bool(p.showNav, d.showNav), showSeekbar: bool(p.showSeekbar, d.showSeekbar),
    showTitle: bool(p.showTitle, d.showTitle), resume: bool(p.resume, d.resume), showNotes: bool(p.showNotes, d.showNotes),
    navigation: p.navigation === 'restricted' ? 'restricted' : 'free',
    accent: typeof p.accent === 'string' && /^#[0-9a-f]{3,8}$/i.test(p.accent) ? p.accent : '',
    logo: typeof p.logo === 'string' && p.logo.startsWith('asset:') ? p.logo : '',
    resources: arr(p.resources, (r) => (isObj(r) && typeof r.url === 'string' && /^(https?:|mailto:)/i.test(r.url) ? { title: str(r.title, r.url), url: r.url } : null)),
    glossary: arr(p.glossary, (g) => (isObj(g) && typeof g.term === 'string' ? { term: g.term, definition: str(g.definition) } : null)),
  };
}

function quizSettings(v: unknown, d: Course['quiz']): Course['quiz'] {
  const q = isObj(v) ? v : {};
  const pct = Number(q.passPercent);
  return {
    passPercent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : d.passPercent,
    reporting: q.reporting === 'completed-incomplete' ? 'completed-incomplete' : q.reporting === 'passed-failed' ? 'passed-failed' : d.reporting,
    completionSlideId: typeof q.completionSlideId === 'string' ? q.completionSlideId : null,
  };
}

export function normalizeCourse(input: unknown): Course {
  if (!isObj(input) || !Array.isArray(input.scenes)) throw new CourseFormatError('This file is not a Scrimshaw course.');
  const schema = num(input.schema, 1);
  if (schema > SCHEMA_VERSION) throw new CourseFormatError(`This course was saved by a newer Scrimshaw (format ${schema}). Update Scrimshaw to open it.`);
  const d = newCourse();
  const scenes = input.scenes
    .map((s) => (isObj(s) && typeof s.id === 'string'
      ? { id: s.id, name: str(s.name, 'Scene'), slides: arr(s.slides, slide),
          bank: isObj(s.bank) ? { shuffle: bool(s.bank.shuffle), draw: Math.max(0, Math.floor(num(s.bank.draw))) } : null }
      : null))
    .filter((s): s is Course['scenes'][number] => s !== null);
  if (scenes.length === 0 || scenes.every((s) => s.slides.length === 0)) throw new CourseFormatError('The course has no slides.');
  return {
    schema: SCHEMA_VERSION,
    id: str(input.id, d.id), title: str(input.title, 'Untitled course'), author: str(input.author), description: str(input.description),
    size: isObj(input.size) ? { w: num(input.size.w, d.size.w), h: num(input.size.h, d.size.h) } : d.size,
    scenes,
    master: (() => {
      const m = slide(input.master) ?? d.master;
      m.layers = [m.layers[0]];
      m.useMaster = false;
      m.inMenu = false;
      m.question = null;
      m.triggers = [];
      for (const o of m.layers[0].objects) o.triggers = [];
      return m;
    })(),
    theme: (() => {
      const t = Array.isArray(input.theme) ? input.theme.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) : [];
      return t.length ? t.slice(0, 16) : [...d.theme];
    })(),
    variables: arr(input.variables, (v) => {
      if (!isObj(v) || !id(v.id) || !id(v.name) || !['text', 'number', 'boolean'].includes(v.type as string)) return null;
      const type = v.type as Course['variables'][number]['type'];
      const initial = type === 'number' ? num(v.initial) : type === 'boolean' ? bool(v.initial) : str(v.initial);
      return { id: v.id, name: v.name, type, initial };
    }),
    startSlideId: typeof input.startSlideId === 'string' ? input.startSlideId : null,
    player: playerSettings(input.player, d.player),
    quiz: quizSettings(input.quiz, d.quiz),
    assets: Object.fromEntries(Object.entries(isObj(input.assets) ? input.assets : {}).filter(([, a]) =>
      isObj(a) && typeof a.id === 'string' && typeof a.data === 'string' && /^data:((image|video|audio)\/[\w.+-]+|text\/vtt);base64,/.test(a.data))
      .map(([k, a]) => { const x = a as Record<string, string>; return [k, { id: x.id, name: str(x.name, 'media'), mime: str(x.mime), data: x.data }]; })),
    created: str(input.created, d.created), modified: str(input.modified, d.modified),
  };
}

export function parseCourse(text: string): Course {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new CourseFormatError('The file is not valid JSON.'); }
  if (isObj(json) && isObj(json.course)) json = json.course; // .scrim wrapper { format, course }
  return normalizeCourse(json);
}

export function serializeCourse(course: Course): string {
  return JSON.stringify({ format: 'scrimshaw', version: SCHEMA_VERSION, course }, null, 1);
}
