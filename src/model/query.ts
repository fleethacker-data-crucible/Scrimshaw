import type { Course, ID, Layer, Scene, Slide, SlideObject, Trigger } from './types.ts';

export function allSlides(course: Course): Slide[] {
  return course.scenes.flatMap((s) => s.slides);
}

export function findSlide(course: Course, id: ID | null | undefined): Slide | undefined {
  if (!id) return undefined;
  for (const sc of course.scenes) for (const sl of sc.slides) if (sl.id === id) return sl;
  return undefined;
}

export function sceneOfSlide(course: Course, slideId: ID): Scene | undefined {
  return course.scenes.find((s) => s.slides.some((sl) => sl.id === slideId));
}

export function slideIndex(course: Course, slideId: ID): number {
  return allSlides(course).findIndex((s) => s.id === slideId);
}

export function startSlide(course: Course): Slide | undefined {
  return findSlide(course, course.startSlideId) ?? allSlides(course)[0];
}

export function baseLayer(slide: Slide): Layer {
  return slide.layers[0];
}

export function findLayer(slide: Slide, id: ID | null | undefined): Layer | undefined {
  return id ? slide.layers.find((l) => l.id === id) : undefined;
}

export function layerOfObject(slide: Slide, objectId: ID): Layer | undefined {
  return slide.layers.find((l) => l.objects.some((o) => o.id === objectId));
}

export function findObject(slide: Slide, objectId: ID | null | undefined): SlideObject | undefined {
  if (!objectId) return undefined;
  for (const l of slide.layers) for (const o of l.objects) if (o.id === objectId) return o;
  return undefined;
}

export function slideObjects(slide: Slide): SlideObject[] {
  return slide.layers.flatMap((l) => l.objects);
}

/** Every trigger on a slide with where it lives, in evaluation order. */
export function slideTriggers(slide: Slide): { trigger: Trigger; layer: Layer | null; object: SlideObject | null }[] {
  const out: { trigger: Trigger; layer: Layer | null; object: SlideObject | null }[] = [];
  for (const t of slide.triggers) out.push({ trigger: t, layer: null, object: null });
  for (const l of slide.layers) {
    for (const t of l.triggers) out.push({ trigger: t, layer: l, object: null });
    for (const o of l.objects) for (const t of o.triggers) out.push({ trigger: t, layer: l, object: o });
  }
  return out;
}

/** Slide ids that a slide can navigate to through its triggers (for the story view). */
export function slideLinks(course: Course, slide: Slide): { to: ID; label: string }[] {
  const slides = allSlides(course);
  const i = slides.findIndex((s) => s.id === slide.id);
  const links: { to: ID; label: string }[] = [];
  for (const { trigger, object } of slideTriggers(slide)) {
    const a = trigger.action;
    const from = object ? object.name : 'Slide';
    if (a.type === 'jump-slide') links.push({ to: a.slideId, label: from });
    else if (a.type === 'next-slide' && slides[i + 1]) links.push({ to: slides[i + 1].id, label: from });
    else if (a.type === 'prev-slide' && slides[i - 1]) links.push({ to: slides[i - 1].id, label: from });
    else if (a.type === 'jump-scene') {
      const sc = course.scenes.find((s) => s.id === a.sceneId);
      if (sc?.slides[0]) links.push({ to: sc.slides[0].id, label: from });
    }
  }
  const seen = new Set<string>();
  return links.filter((l) => (seen.has(l.to + l.label) ? false : (seen.add(l.to + l.label), true)));
}

export function variableByName(course: Course, name: string) {
  const n = name.trim().toLowerCase();
  return course.variables.find((v) => v.name.toLowerCase() === n);
}
