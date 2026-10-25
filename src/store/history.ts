// Undo/redo for the editor. Every edit clones the course (media assets are shared by reference,
// since they never change once added), runs a mutation on the clone, and pushes the previous
// version. Edits with the same mergeKey within MERGE_MS collapse into one undo step, so a drag
// or a burst of typing undoes in one go.
import { findLayer, findSlide, startSlide } from '../model/query.ts';
import type { Course, ID } from '../model/types.ts';

export const HISTORY_LIMIT = 200;
export const MERGE_MS = 900;

export interface Selection {
  slideId: ID;
  layerId: ID;
  objectIds: ID[];
}

export interface EditorState {
  course: Course;
  sel: Selection;
  past: { course: Course; sel: Selection; label: string }[];
  future: { course: Course; sel: Selection; label: string }[];
  mergeKey: string | null;
  mergeAt: number;
  /** Increments on every content change; autosave watches it. */
  revision: number;
}

export type EditFn = (draft: Course, sel: Selection) => Partial<Selection> | void;

export type Command =
  | { type: 'edit'; label: string; fn: EditFn; mergeKey?: string; now?: number }
  | { type: 'select'; sel: Partial<Selection> }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; course: Course };

export function cloneCourse(c: Course): Course {
  return {
    ...c,
    size: { ...c.size },
    scenes: structuredClone(c.scenes),
    variables: structuredClone(c.variables),
    player: { ...c.player },
    quiz: { ...c.quiz },
    assets: c.assets,
  };
}

/** Keeps a selection pointing at things that exist. */
export function fixSelection(course: Course, sel: Partial<Selection>, prev?: Selection): Selection {
  const slide = findSlide(course, sel.slideId ?? prev?.slideId) ?? startSlide(course);
  if (!slide) throw new Error('Course has no slides');
  const layer = findLayer(slide, sel.layerId ?? (slide.id === prev?.slideId ? prev?.layerId : undefined)) ?? slide.layers[0];
  const ids = sel.objectIds ?? (slide.id === prev?.slideId && layer.id === prev?.layerId ? prev.objectIds : []);
  const objectIds = ids.filter((id) => layer.objects.some((o) => o.id === id));
  return { slideId: slide.id, layerId: layer.id, objectIds };
}

export function initEditor(course: Course): EditorState {
  return { course, sel: fixSelection(course, {}), past: [], future: [], mergeKey: null, mergeAt: 0, revision: 0 };
}

export function reduce(state: EditorState, cmd: Command): EditorState {
  switch (cmd.type) {
    case 'select': {
      const sel = fixSelection(state.course, cmd.sel, state.sel);
      return { ...state, sel, mergeKey: null };
    }
    case 'load':
      return { ...initEditor(cmd.course), revision: state.revision + 1 };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        course: prev.course,
        sel: fixSelection(prev.course, prev.sel),
        past: state.past.slice(0, -1),
        future: [{ course: state.course, sel: state.sel, label: prev.label }, ...state.future],
        mergeKey: null,
        revision: state.revision + 1,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        course: next.course,
        sel: fixSelection(next.course, next.sel),
        past: [...state.past, { course: state.course, sel: state.sel, label: next.label }],
        future: state.future.slice(1),
        mergeKey: null,
        revision: state.revision + 1,
      };
    }
    case 'edit': {
      const draft = cloneCourse(state.course);
      let nextSel: Partial<Selection> | void;
      try {
        nextSel = cmd.fn(draft, { ...state.sel, objectIds: [...state.sel.objectIds] });
      } catch (e) {
        console.error(`Edit "${cmd.label}" failed`, e);
        return state;
      }
      draft.modified = new Date().toISOString();
      const now = cmd.now ?? Date.now();
      const merge = !!cmd.mergeKey && cmd.mergeKey === state.mergeKey && now - state.mergeAt < MERGE_MS && state.past.length > 0;
      const past = merge ? state.past : [...state.past, { course: state.course, sel: state.sel, label: cmd.label }].slice(-HISTORY_LIMIT);
      return {
        ...state,
        course: draft,
        sel: fixSelection(draft, nextSel ?? state.sel, state.sel),
        past,
        future: [],
        mergeKey: cmd.mergeKey ?? null,
        mergeAt: now,
        revision: state.revision + 1,
      };
    }
  }
}

export const undoLabel = (s: EditorState) => s.past[s.past.length - 1]?.label ?? null;
export const redoLabel = (s: EditorState) => s.future[0]?.label ?? null;
