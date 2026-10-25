// Editing operations. Each takes a draft course (already cloned by the history reducer) and
// mutates it in place.
import { newLayer, newScene, newSlide, uid } from '../model/factory.ts';
import { allSlides, findLayer, findObject, findSlide, sceneOfSlide, slideObjects } from '../model/query.ts';
import type { Course, ID, Layer, Scene, Slide, SlideObject, Trigger } from '../model/types.ts';

export function layerOf(c: Course, slideId: ID, layerId: ID): Layer {
  const sl = findSlide(c, slideId);
  const l = sl && findLayer(sl, layerId);
  if (!l) throw new Error('Layer not found');
  return l;
}

export function objectsIn(c: Course, slideId: ID, ids: ID[]): SlideObject[] {
  const sl = findSlide(c, slideId);
  if (!sl) return [];
  return ids.map((id) => findObject(sl, id)).filter((o): o is SlideObject => !!o);
}

export function uniqueName(existing: string[], base: string): string {
  const set = new Set(existing.map((n) => n.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

// ---------- id remapping for copies ----------

function remapTrigger(t: Trigger, map: Map<ID, ID>): Trigger {
  const m = (id: ID) => map.get(id) ?? id;
  const n: Trigger = structuredClone(t);
  n.id = uid('t');
  const a = n.action;
  if ('layerId' in a && a.layerId !== 'this') a.layerId = m(a.layerId);
  if ('objectId' in a && a.objectId !== 'this') a.objectId = m(a.objectId);
  if (n.event.type === 'state-change') n.event.objectId = m(n.event.objectId);
  for (const c of n.conditions) if (c.kind === 'state') c.objectId = m(c.objectId);
  return n;
}

/** Deep-copies objects with fresh ids; references between the copied objects follow the copies. */
export function copyObjects(objs: SlideObject[], extraMap = new Map<ID, ID>()): SlideObject[] {
  const map = new Map(extraMap);
  for (const o of objs) if (!map.has(o.id)) map.set(o.id, uid('o'));
  const groups = new Map<ID, ID>();
  for (const o of objs) if (o.groupId && !groups.has(o.groupId)) groups.set(o.groupId, uid('g'));
  return objs.map((o) => ({
    ...structuredClone(o),
    id: map.get(o.id)!,
    groupId: o.groupId ? groups.get(o.groupId)! : null,
    states: o.states.map((s) => ({ ...structuredClone(s), id: uid('st') })),
    triggers: o.triggers.map((t) => remapTrigger(t, map)),
  }));
}

export function copySlide(slide: Slide): Slide {
  const map = new Map<ID, ID>();
  for (const l of slide.layers) {
    map.set(l.id, uid('l'));
    for (const o of l.objects) map.set(o.id, uid('o'));
  }
  const s: Slide = structuredClone(slide);
  s.id = uid('s');
  s.title = `${slide.title} (copy)`;
  s.triggers = slide.triggers.map((t) => remapTrigger(t, map));
  s.layers = slide.layers.map((l) => ({
    ...structuredClone(l),
    id: map.get(l.id)!,
    triggers: l.triggers.map((t) => remapTrigger(t, map)),
    objects: copyObjects(l.objects, map),
  }));
  if (s.question) {
    const q = s.question;
    const m = (id: ID | null) => (id ? map.get(id) ?? id : null);
    q.inputObjectId = m(q.inputObjectId);
    q.correctLayerId = m(q.correctLayerId);
    q.incorrectLayerId = m(q.incorrectLayerId);
    q.tryAgainLayerId = m(q.tryAgainLayerId);
  }
  return s;
}

// ---------- slides and scenes ----------

export function insertSlideAfter(c: Course, afterId: ID | null, slide: Slide): Slide {
  const scene = (afterId && sceneOfSlide(c, afterId)) || c.scenes[c.scenes.length - 1];
  const i = afterId ? scene.slides.findIndex((s) => s.id === afterId) : scene.slides.length - 1;
  scene.slides.splice(i + 1, 0, slide);
  return slide;
}

/** Removes a slide; returns the id of a neighbour to select. Triggers that pointed at it are removed. */
export function deleteSlide(c: Course, slideId: ID): ID | null {
  if (allSlides(c).length <= 1) return null;
  const scene = sceneOfSlide(c, slideId);
  if (!scene) return null;
  const flat = allSlides(c);
  const i = flat.findIndex((s) => s.id === slideId);
  scene.slides = scene.slides.filter((s) => s.id !== slideId);
  if (c.startSlideId === slideId) c.startSlideId = null;
  if (c.quiz.completionSlideId === slideId) c.quiz.completionSlideId = null;
  forEachTriggerList(c, (list) => list.filter((t) => !((t.action.type === 'jump-slide' || t.action.type === 'lightbox-slide') && t.action.slideId === slideId)));
  return (flat[i + 1] ?? flat[i - 1])?.id ?? null;
}

export function moveSlide(c: Course, slideId: ID, toSceneId: ID, toIndex: number) {
  const from = sceneOfSlide(c, slideId);
  const to = c.scenes.find((s) => s.id === toSceneId);
  if (!from || !to) return;
  const slide = from.slides.find((s) => s.id === slideId)!;
  from.slides = from.slides.filter((s) => s.id !== slideId);
  to.slides.splice(Math.max(0, Math.min(toIndex, to.slides.length)), 0, slide);
}

export function addScene(c: Course, name?: string): Scene {
  const scene = newScene(name ?? uniqueName(c.scenes.map((s) => s.name), `Scene ${c.scenes.length + 1}`), [newSlide()]);
  c.scenes.push(scene);
  return scene;
}

export function deleteScene(c: Course, sceneId: ID): boolean {
  if (c.scenes.length <= 1) return false;
  const scene = c.scenes.find((s) => s.id === sceneId);
  if (!scene) return false;
  for (const sl of scene.slides) {
    if (c.startSlideId === sl.id) c.startSlideId = null;
    if (c.quiz.completionSlideId === sl.id) c.quiz.completionSlideId = null;
  }
  const ids = new Set(scene.slides.map((s) => s.id));
  c.scenes = c.scenes.filter((s) => s.id !== sceneId);
  forEachTriggerList(c, (list) => list.filter((t) => !(((t.action.type === 'jump-slide' || t.action.type === 'lightbox-slide') && ids.has(t.action.slideId)) || (t.action.type === 'jump-scene' && t.action.sceneId === sceneId))));
  return true;
}

function forEachTriggerList(c: Course, fn: (list: Trigger[]) => Trigger[]) {
  for (const sl of allSlides(c)) {
    sl.triggers = fn(sl.triggers);
    for (const l of sl.layers) {
      l.triggers = fn(l.triggers);
      for (const o of l.objects) o.triggers = fn(o.triggers);
    }
  }
}

// ---------- layers ----------

export function addLayer(slide: Slide, name?: string): Layer {
  const layer = newLayer(name ?? uniqueName(slide.layers.map((l) => l.name), 'New layer'));
  slide.layers.push(layer);
  return layer;
}

export function deleteLayer(slide: Slide, layerId: ID) {
  const l = findLayer(slide, layerId);
  if (!l || l.base) return;
  slide.layers = slide.layers.filter((x) => x.id !== layerId);
  const ids = new Set(l.objects.map((o) => o.id));
  const clean = (list: Trigger[]) => list.filter((t) => {
    const a = t.action;
    if ((a.type === 'show-layer' || a.type === 'hide-layer') && a.layerId === layerId) return false;
    if ('objectId' in a && ids.has(a.objectId)) return false;
    return true;
  });
  slide.triggers = clean(slide.triggers);
  for (const x of slide.layers) {
    x.triggers = clean(x.triggers);
    for (const o of x.objects) o.triggers = clean(o.triggers);
  }
  const q = slide.question;
  if (q) {
    if (q.correctLayerId === layerId) q.correctLayerId = null;
    if (q.incorrectLayerId === layerId) q.incorrectLayerId = null;
    if (q.tryAgainLayerId === layerId) q.tryAgainLayerId = null;
  }
}

export function duplicateLayer(slide: Slide, layerId: ID): Layer | null {
  const l = findLayer(slide, layerId);
  if (!l || l.base) return null;
  const map = new Map<ID, ID>([[l.id, uid('l')]]);
  const copy: Layer = { ...structuredClone(l), id: map.get(l.id)!, name: uniqueName(slide.layers.map((x) => x.name), `${l.name} copy`), objects: [], triggers: [] };
  copy.objects = copyObjects(l.objects, map);
  copy.triggers = l.triggers.map((t) => remapTrigger(t, map));
  slide.layers.splice(slide.layers.indexOf(l) + 1, 0, copy);
  return copy;
}

// ---------- objects ----------

export function deleteObjects(slide: Slide, ids: ID[]) {
  const set = new Set(ids);
  for (const l of slide.layers) l.objects = l.objects.filter((o) => !set.has(o.id));
  const clean = (list: Trigger[]) => list.filter((t) => {
    const a = t.action;
    if ('objectId' in a && a.objectId !== 'this' && set.has(a.objectId)) return false;
    if (t.event.type === 'state-change' && set.has(t.event.objectId)) return false;
    t.conditions = t.conditions.filter((c) => !(c.kind === 'state' && set.has(c.objectId)));
    return true;
  });
  slide.triggers = clean(slide.triggers);
  for (const l of slide.layers) {
    l.triggers = clean(l.triggers);
    for (const o of l.objects) o.triggers = clean(o.triggers);
  }
  if (slide.question?.inputObjectId && set.has(slide.question.inputObjectId)) slide.question.inputObjectId = null;
}

export type ZOrder = 'front' | 'forward' | 'backward' | 'back';
export function reorder(layer: Layer, ids: ID[], how: ZOrder) {
  const set = new Set(ids);
  const picked = layer.objects.filter((o) => set.has(o.id));
  const rest = layer.objects.filter((o) => !set.has(o.id));
  if (how === 'front') { layer.objects = [...rest, ...picked]; return; }
  if (how === 'back') { layer.objects = [...picked, ...rest]; return; }
  const list = [...layer.objects];
  const order = how === 'forward' ? [...list.keys()].reverse() : [...list.keys()];
  for (const i of order) {
    if (!set.has(list[i].id)) continue;
    const j = how === 'forward' ? i + 1 : i - 1;
    if (j < 0 || j >= list.length || set.has(list[j].id)) continue;
    [list[i], list[j]] = [list[j], list[i]];
  }
  layer.objects = list;
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
/** Aligns to the selection bounds, or to the slide when only one object is selected. */
export function align(objs: SlideObject[], how: Align, slide: { w: number; h: number }) {
  if (objs.length === 0) return;
  const box = objs.length === 1
    ? { x: 0, y: 0, r: slide.w, b: slide.h }
    : { x: Math.min(...objs.map((o) => o.x)), y: Math.min(...objs.map((o) => o.y)), r: Math.max(...objs.map((o) => o.x + o.w)), b: Math.max(...objs.map((o) => o.y + o.h)) };
  for (const o of objs) {
    if (how === 'left') o.x = box.x;
    if (how === 'right') o.x = box.r - o.w;
    if (how === 'hcenter') o.x = Math.round((box.x + box.r) / 2 - o.w / 2);
    if (how === 'top') o.y = box.y;
    if (how === 'bottom') o.y = box.b - o.h;
    if (how === 'vmiddle') o.y = Math.round((box.y + box.b) / 2 - o.h / 2);
  }
}

export function distribute(objs: SlideObject[], axis: 'h' | 'v') {
  if (objs.length < 3) return;
  const key = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  const sorted = [...objs].sort((a, b) => a[key] - b[key]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const total = sorted.reduce((n, o) => n + o[size], 0);
  const gap = (last[key] + last[size] - first[key] - total) / (sorted.length - 1);
  let pos = first[key];
  for (const o of sorted) { o[key] = Math.round(pos); pos += o[size] + gap; }
}

export function moveObjectsToLayer(slide: Slide, ids: ID[], toLayerId: ID) {
  const to = findLayer(slide, toLayerId);
  if (!to) return;
  const set = new Set(ids);
  const moving = slideObjects(slide).filter((o) => set.has(o.id));
  for (const l of slide.layers) l.objects = l.objects.filter((o) => !set.has(o.id));
  to.objects.push(...moving);
}

/** Removes embedded media no object references any more. */
export function pruneAssets(c: Course): Course['assets'] {
  const used = new Set<string>();
  for (const sl of [...allSlides(c), c.master]) {
    if (sl.background.startsWith('asset:')) used.add(sl.background.slice(6));
    for (const o of slideObjects(sl)) {
      if (o.src.startsWith('asset:')) used.add(o.src.slice(6));
      if (o.captions.startsWith('asset:')) used.add(o.captions.slice(6));
    }
  }
  if (c.player.logo.startsWith('asset:')) used.add(c.player.logo.slice(6));
  return Object.fromEntries(Object.entries(c.assets).filter(([id]) => used.has(id)));
}

/** Expands a set of ids to whole groups. */
export function withGroups(objs: SlideObject[], ids: ID[]): ID[] {
  const groups = new Set(objs.filter((o) => ids.includes(o.id) && o.groupId).map((o) => o.groupId));
  return objs.filter((o) => ids.includes(o.id) || (o.groupId && groups.has(o.groupId))).map((o) => o.id);
}
