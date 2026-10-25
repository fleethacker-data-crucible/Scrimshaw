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

function trigger(v: unknown): Trigger | null {
  if (!isObj(v) || !isObj(v.event) || !isObj(v.action) || typeof v.id !== 'string') return null;
  if (typeof v.event.type !== 'string' || typeof v.action.type !== 'string') return null;
  return {
    id: v.id,
    event: v.event as Trigger['event'],
    action: v.action as Trigger['action'],
    conditions: arr(v.conditions, (c) => (isObj(c) && (c.kind === 'variable' || c.kind === 'state') ? (c as Trigger['conditions'][number]) : null)),
    join: v.join === 'or' ? 'or' : 'and',
    enabled: bool(v.enabled, true),
  };
}

const ANIMS = ['none', 'fade', 'fly-left', 'fly-right', 'fly-up', 'fly-down', 'zoom', 'wipe'];
function anim(v: unknown, d: SlideObject['enter']): SlideObject['enter'] {
  if (!isObj(v) || typeof v.type !== 'string' || !ANIMS.includes(v.type)) return d;
  return { type: v.type as SlideObject['enter']['type'], duration: Math.max(0.05, num(v.duration, d.duration)) };
}

const QUESTION_KINDS = ['multiple-choice', 'multiple-response', 'true-false', 'fill-in', 'drag-drop', 'hotspot', 'numeric'];
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

function object(v: unknown): SlideObject | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.kind !== 'string') return null;
  const kinds = ['text', 'shape', 'image', 'button', 'hotspot', 'input', 'choice', 'video', 'audio', 'slider'];
  if (!kinds.includes(v.kind)) return null;
  const d = newObject(v.kind as SlideObject['kind']);
  return {
    ...d,
    ...(v as Partial<SlideObject>),
    id: v.id,
    style: { ...baseStyle(), ...(isObj(v.style) ? (v.style as object) : {}) },
    enter: anim(v.enter, d.enter),
    exit: anim(v.exit, d.exit),
    states: arr(v.states, (s) => (isObj(s) && typeof s.id === 'string' && typeof s.name === 'string'
      ? { id: s.id, name: s.name, style: isObj(s.style) ? (s.style as object) : {}, text: typeof s.text === 'string' ? s.text : null }
      : null)),
    triggers: arr(v.triggers, trigger),
    x: num(v.x, d.x), y: num(v.y, d.y), w: Math.max(1, num(v.w, d.w)), h: Math.max(1, num(v.h, d.h)),
    rotation: num(v.rotation), start: Math.max(0, num(v.start)),
    draggable: bool(v.draggable), dropTarget: bool(v.dropTarget),
    groupId: typeof v.groupId === 'string' ? v.groupId : null,
    correctTargetId: typeof v.correctTargetId === 'string' ? v.correctTargetId : null,
    end: typeof v.end === 'number' ? v.end : null,
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
  };
}

function playerSettings(v: unknown, d: Course['player']): Course['player'] {
  const p = isObj(v) ? v : {};
  return {
    ...d,
    showMenu: bool(p.showMenu, d.showMenu), showNav: bool(p.showNav, d.showNav), showSeekbar: bool(p.showSeekbar, d.showSeekbar),
    showTitle: bool(p.showTitle, d.showTitle), resume: bool(p.resume, d.resume),
    navigation: p.navigation === 'restricted' ? 'restricted' : 'free',
    accent: typeof p.accent === 'string' && /^#[0-9a-f]{3,8}$/i.test(p.accent) ? p.accent : '',
    resources: arr(p.resources, (r) => (isObj(r) && typeof r.url === 'string' && /^(https?:|mailto:)/i.test(r.url) ? { title: str(r.title, r.url), url: r.url } : null)),
    glossary: arr(p.glossary, (g) => (isObj(g) && typeof g.term === 'string' ? { term: g.term, definition: str(g.definition) } : null)),
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
    variables: arr(input.variables, (v) => (isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && ['text', 'number', 'boolean'].includes(v.type as string)
      ? (v as unknown as Course['variables'][number]) : null)),
    startSlideId: typeof input.startSlideId === 'string' ? input.startSlideId : null,
    player: playerSettings(input.player, d.player),
    quiz: { ...d.quiz, ...(isObj(input.quiz) ? input.quiz : {}) } as Course['quiz'],
    assets: Object.fromEntries(Object.entries(isObj(input.assets) ? input.assets : {}).filter(([, a]) =>
      isObj(a) && typeof a.id === 'string' && typeof a.data === 'string' && /^data:(image|video|audio)\/[\w.+-]+;base64,/.test(a.data))
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
