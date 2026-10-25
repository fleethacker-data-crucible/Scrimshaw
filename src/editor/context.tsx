import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { findLayer, findSlide } from '../model/query.ts';
import type { Course, Layer, Slide, SlideObject } from '../model/types.ts';
import { initEditor, reduce, type Command, type EditFn, type EditorState, type Selection } from '../store/history.ts';

export interface EditorApi {
  state: EditorState;
  course: Course;
  slide: Slide;
  layer: Layer;
  selected: SlideObject[];
  dispatch: (c: Command) => void;
  edit: (label: string, fn: EditFn, mergeKey?: string) => void;
  select: (sel: Partial<Selection>) => void;
  /** Edits the selected objects in place. */
  editSelected: (label: string, fn: (o: SlideObject, slide: Slide) => void, mergeKey?: string) => void;
}

const Ctx = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEditor outside EditorProvider');
  return v;
}

export function EditorProvider({ initial, children }: { initial: Course; children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initial, initEditor);
  const edit = useCallback((label: string, fn: EditFn, mergeKey?: string) => dispatch({ type: 'edit', label, fn, mergeKey }), []);
  const select = useCallback((sel: Partial<Selection>) => dispatch({ type: 'select', sel }), []);
  const editSelected = useCallback<EditorApi['editSelected']>((label, fn, mergeKey) => dispatch({
    type: 'edit', label, mergeKey,
    fn: (c, sel) => {
      const slide = findSlide(c, sel.slideId)!;
      for (const l of slide.layers) for (const o of l.objects) if (sel.objectIds.includes(o.id)) fn(o, slide);
    },
  }), []);
  const api = useMemo<EditorApi>(() => {
    const slide = findSlide(state.course, state.sel.slideId)!;
    const layer = findLayer(slide, state.sel.layerId) ?? slide.layers[0];
    const selected = layer.objects.filter((o) => state.sel.objectIds.includes(o.id));
    return { state, course: state.course, slide, layer, selected, dispatch, edit, select, editSelected };
  }, [state, edit, select, editSelected]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
