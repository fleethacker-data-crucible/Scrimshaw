// Plain-language descriptions of triggers, in the style of Storyline's trigger panel.
import { allSlides, findLayer, findObject } from './query.ts';
import type { Action, Condition, ConditionOp, Course, Slide, SlideObject, Trigger, TriggerEvent, VariableOp } from './types.ts';

export const EVENT_LABELS: Record<TriggerEvent['type'], string> = {
  click: 'User clicks',
  'hover-enter': 'Mouse hovers over',
  'hover-leave': 'Mouse leaves',
  'timeline-start': 'Timeline starts',
  'timeline-end': 'Timeline ends',
  'timeline-reaches': 'Timeline reaches',
  'variable-change': 'Variable changes',
  key: 'User presses a key',
  'state-change': 'State of an object changes',
  drop: 'User drops this object on',
};

export const ACTION_LABELS: Record<Action['type'], string> = {
  'jump-slide': 'Jump to slide',
  'next-slide': 'Jump to next slide',
  'prev-slide': 'Jump to previous slide',
  'jump-scene': 'Jump to scene',
  'show-layer': 'Show layer',
  'hide-layer': 'Hide layer',
  'set-state': 'Change state of',
  'adjust-variable': 'Adjust variable',
  'submit-interaction': 'Submit interaction',
  'reset-results': 'Reset results (retry quiz)',
  'open-url': 'Open URL',
  'play-media': 'Play media',
  'pause-media': 'Pause media',
  'pause-timeline': 'Pause timeline',
  'resume-timeline': 'Resume timeline',
  'restart-course': 'Restart course',
  'exit-course': 'Exit course',
};

export const OP_LABELS: Record<ConditionOp, string> = {
  '==': 'equal to', '!=': 'not equal to', '<': 'less than', '<=': 'less than or equal to',
  '>': 'greater than', '>=': 'greater than or equal to', contains: 'contains', 'not-contains': 'does not contain',
  empty: 'is empty', 'not-empty': 'is not empty',
};

export const VAR_OP_LABELS: Record<VariableOp, string> = {
  set: '= Assign', assign: '= Assign', add: '+ Add', subtract: '− Subtract', multiply: '× Multiply', divide: '÷ Divide', toggle: 'Toggle (true/false)',
};

function varName(course: Course, id: string) {
  return course.variables.find((v) => v.id === id)?.name ?? (id.includes('.') ? id : 'missing variable');
}

function objName(slide: Slide, id: string, self: SlideObject | null) {
  if (id === 'this') return self ? `${self.name} (this)` : 'this object';
  return findObject(slide, id)?.name ?? 'missing object';
}

export function describeAction(course: Course, slide: Slide, a: Action, self: SlideObject | null = null): string {
  const slides = allSlides(course);
  switch (a.type) {
    case 'jump-slide': return `Jump to ${slides.find((s) => s.id === a.slideId)?.title ?? 'missing slide'}`;
    case 'jump-scene': return `Jump to scene ${course.scenes.find((s) => s.id === a.sceneId)?.name ?? 'missing scene'}`;
    case 'show-layer': return `Show layer ${findLayer(slide, a.layerId)?.name ?? 'missing layer'}`;
    case 'hide-layer': return a.layerId === 'this' ? 'Hide this layer' : `Hide layer ${findLayer(slide, a.layerId)?.name ?? 'missing layer'}`;
    case 'set-state': return `Change state of ${objName(slide, a.objectId, self)} to ${a.state}`;
    case 'adjust-variable': {
      const operand = a.fromVariableId ? varName(course, a.fromVariableId) : JSON.stringify(a.value);
      const n = varName(course, a.variableId);
      switch (a.op) {
        case 'set': case 'assign': return `Set ${n} to ${operand}`;
        case 'add': return `Add ${operand} to ${n}`;
        case 'subtract': return `Subtract ${operand} from ${n}`;
        case 'multiply': return `Multiply ${n} by ${operand}`;
        case 'divide': return `Divide ${n} by ${operand}`;
        case 'toggle': return `Toggle ${n}`;
      }
      return `Adjust ${n}`;
    }
    case 'open-url': return `Open ${a.url || 'URL'}`;
    case 'play-media': return `Play ${objName(slide, a.objectId, self)}`;
    case 'pause-media': return `Pause ${objName(slide, a.objectId, self)}`;
    default: return ACTION_LABELS[a.type];
  }
}

export function describeEvent(course: Course, slide: Slide, e: TriggerEvent, owner: SlideObject | null): string {
  switch (e.type) {
    case 'click': return `user clicks ${owner?.name ?? 'the slide'}`;
    case 'hover-enter': return `mouse hovers over ${owner?.name ?? 'object'}`;
    case 'hover-leave': return `mouse leaves ${owner?.name ?? 'object'}`;
    case 'timeline-start': return 'timeline starts';
    case 'timeline-end': return 'timeline ends';
    case 'timeline-reaches': return `timeline reaches ${e.time}s`;
    case 'variable-change': return `${varName(course, e.variableId)} changes`;
    case 'key': return `user presses ${e.key}`;
    case 'state-change': return `${objName(slide, e.objectId, owner)} changes to ${e.state}`;
    case 'drop': return `user drops ${owner?.name ?? 'object'} on ${e.targetId === 'any' ? 'any drop target' : objName(slide, e.targetId, owner)}`;
  }
}

export function describeCondition(course: Course, slide: Slide, c: Condition, self: SlideObject | null): string {
  if (c.kind === 'state') return `${objName(slide, c.objectId, self)} is ${c.is ? '' : 'not '}${c.state}`;
  const right = c.op === 'empty' || c.op === 'not-empty' ? '' : ` ${c.compareVariableId ? varName(course, c.compareVariableId) : JSON.stringify(c.value)}`;
  return `${varName(course, c.variableId)} ${c.op === 'empty' || c.op === 'not-empty' ? OP_LABELS[c.op] : `is ${OP_LABELS[c.op]}`}${right}`;
}

export function describeTrigger(course: Course, slide: Slide, t: Trigger, owner: SlideObject | null) {
  return {
    action: describeAction(course, slide, t.action, owner),
    when: describeEvent(course, slide, t.event, owner),
    conditions: t.conditions.map((c) => describeCondition(course, slide, c, owner)).join(t.join === 'or' ? ' or ' : ' and '),
  };
}

/** Problems that would break playback: missing targets, variables, layers. */
export function validateCourse(course: Course): string[] {
  const problems: string[] = [];
  const varIds = new Set(course.variables.map((v) => v.id));
  for (const sl of allSlides(course)) {
    const check = (t: Trigger, where: string) => {
      const a = t.action;
      const missing = (what: string) => problems.push(`${sl.title} › ${where}: the trigger "${ACTION_LABELS[a.type]}" points at a ${what} that no longer exists.`);
      if (a.type === 'jump-slide' && !allSlides(course).some((s) => s.id === a.slideId)) missing('slide');
      if (a.type === 'jump-scene' && !course.scenes.some((s) => s.id === a.sceneId)) missing('scene');
      if ((a.type === 'show-layer' || (a.type === 'hide-layer' && a.layerId !== 'this')) && !findLayer(sl, a.layerId)) missing('layer');
      if ((a.type === 'set-state' || a.type === 'play-media' || a.type === 'pause-media') && a.objectId !== 'this' && !findObject(sl, a.objectId)) missing('object');
      if (a.type === 'adjust-variable' && !varIds.has(a.variableId)) missing('variable');
      if (t.event.type === 'variable-change' && !varIds.has(t.event.variableId)) problems.push(`${sl.title} › ${where}: a trigger waits for a variable that no longer exists.`);
    };
    for (const t of sl.triggers) check(t, 'slide trigger');
    for (const l of sl.layers) {
      for (const t of l.triggers) check(t, `layer ${l.name}`);
      for (const o of l.objects) for (const t of o.triggers) check(t, o.name);
    }
    const q = sl.question;
    if (q && q.kind !== 'fill-in' && q.kind !== 'drag-drop' && !sl.layers.some((l) => l.objects.some((o) => o.kind === 'choice' && o.correct))) problems.push(`${sl.title}: the question has no correct answer marked.`);
    if (q && q.kind === 'fill-in' && q.accepted.filter((a) => a.trim()).length === 0) problems.push(`${sl.title}: the fill-in question has no accepted answers.`);
    if (q && q.kind === 'fill-in' && !(q.inputObjectId && findObject(sl, q.inputObjectId))) problems.push(`${sl.title}: the fill-in question has no text entry box linked.`);
    if (q && q.kind === 'drag-drop' && !sl.layers.some((l) => l.objects.some((o) => o.draggable && o.correctTargetId && findObject(sl, o.correctTargetId)?.dropTarget))) problems.push(`${sl.title}: the drag-and-drop question has no item with a correct drop target.`);
    for (const l of sl.layers) for (const o of l.objects) {
      if (o.kind === 'image' && !o.decorative && !o.alt.trim()) problems.push(`${sl.title} › ${o.name}: add alt text or mark the image decorative.`);
    }
  }
  return problems;
}
