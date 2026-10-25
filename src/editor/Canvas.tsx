// The slide canvas: selection, marquee, move/resize/rotate with snapping guides, inline text editing.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { findSlide } from '../model/query.ts';
import type { ID, SlideObject } from '../model/types.ts';
import { SlideView } from '../render/SlideView.tsx';
import { useEditor } from './context.tsx';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rot';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const SNAP = 6;

interface Drag {
  kind: 'move' | 'resize' | 'marquee' | 'rotate';
  handle?: Handle;
  startX: number;
  startY: number;
  orig: Map<ID, { x: number; y: number; w: number; h: number; rotation: number }>;
  additive?: boolean;
  moved: boolean;
}

export interface CanvasProps {
  zoom: number | 'fit';
  onZoomResolved: (z: number) => void;
  snap: boolean;
  grid: boolean;
  previewStates: Record<ID, string>;
}

const textKinds = new Set(['text', 'shape', 'button', 'choice', 'input']);

export function Canvas({ zoom, onZoomResolved, snap, grid, previewStates }: CanvasProps) {
  const { course, slide, layer, state, select, edit } = useEditor();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [live, setLive] = useState<Map<ID, { x: number; y: number; w: number; h: number; rotation: number }> | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [editing, setEditing] = useState<ID | null>(null);
  const scale = zoom === 'fit' ? fit : zoom;
  const { w: W, h: H } = course.size;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setFit(Math.max(0.1, Math.min((el.clientWidth - 64) / W, (el.clientHeight - 64) / H)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  useEffect(() => onZoomResolved(scale), [scale, onZoomResolved]);
  useEffect(() => setEditing(null), [state.sel.slideId, state.sel.layerId]);

  const objects = layer.objects.filter((o) => !o.editorHidden);
  const selectedIds = state.sel.objectIds;
  const geom = (o: SlideObject) => live?.get(o.id) ?? o;

  const toSlide = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  /** Topmost object of the editing layer under the point. */
  const hit = (x: number, y: number): SlideObject | null => {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.locked) continue;
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return o;
    }
    return null;
  };

  const snapTargets = () => {
    const others = objects.filter((o) => !selectedIds.includes(o.id));
    const v = [0, W / 2, W, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const h = [0, H / 2, H, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    return { v, h };
  };

  const snapValue = (vals: number[], targets: number[]) => {
    let best: { d: number; delta: number; at: number } | null = null;
    for (const v of vals) for (const t of targets) {
      const d = Math.abs(v - t);
      if (d <= SNAP / scale && (!best || d < best.d)) best = { d, delta: t - v, at: t };
    }
    return best;
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0 || editing) return;
    const p = toSlide(e);
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const orig = new Map(objects.filter((o) => selectedIds.includes(o.id)).map((o) => [o.id, { x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation }]));
    if (handle) {
      setDrag({ kind: handle === 'rot' ? 'rotate' : 'resize', handle, startX: p.x, startY: p.y, orig, moved: false });
      return;
    }
    const o = hit(p.x, p.y);
    if (!o) {
      setDrag({ kind: 'marquee', startX: p.x, startY: p.y, orig, additive: e.shiftKey || e.ctrlKey || e.metaKey, moved: false });
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) select({ objectIds: [] });
      return;
    }
    let ids = selectedIds;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ids = selectedIds.includes(o.id) ? selectedIds.filter((id) => id !== o.id) : [...selectedIds, o.id];
      select({ objectIds: ids });
    } else if (!selectedIds.includes(o.id)) {
      ids = [o.id];
      select({ objectIds: ids });
    }
    const moveOrig = new Map(objects.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y, w: x.w, h: x.h, rotation: x.rotation }]));
    setDrag({ kind: 'move', startX: p.x, startY: p.y, orig: moveOrig, moved: false });
  };

  const onPointerMove = (e: RPointerEvent) => {
    if (!drag) return;
    const p = toSlide(e);
    let dx = p.x - drag.startX;
    let dy = p.y - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2 / scale) return;
    if (drag.kind === 'marquee') {
      const box = { x: Math.min(p.x, drag.startX), y: Math.min(p.y, drag.startY), w: Math.abs(dx), h: Math.abs(dy) };
      setMarquee(box);
      setDrag({ ...drag, moved: true });
      return;
    }
    const next = new Map(drag.orig);
    const gv: number[] = [];
    const gh: number[] = [];
    if (drag.kind === 'move') {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (snap) {
        const all = [...drag.orig.values()];
        const minX = Math.min(...all.map((g) => g.x)) + dx;
        const maxX = Math.max(...all.map((g) => g.x + g.w)) + dx;
        const minY = Math.min(...all.map((g) => g.y)) + dy;
        const maxY = Math.max(...all.map((g) => g.y + g.h)) + dy;
        const t = snapTargets();
        const sx = snapValue([minX, (minX + maxX) / 2, maxX], t.v);
        const sy = snapValue([minY, (minY + maxY) / 2, maxY], t.h);
        if (sx) { dx += sx.delta; gv.push(sx.at); }
        if (sy) { dy += sy.delta; gh.push(sy.at); }
      }
      for (const [id, g] of drag.orig) next.set(id, { ...g, x: Math.round(g.x + dx), y: Math.round(g.y + dy) });
    } else if (drag.kind === 'resize' && drag.handle) {
      const [id, g] = [...drag.orig.entries()][0] ?? [];
      if (!id || !g) return;
      const h = drag.handle;
      let { x, y, w, hgt } = { x: g.x, y: g.y, w: g.w, hgt: g.h };
      if (h.includes('e')) w = g.w + dx;
      if (h.includes('s')) hgt = g.h + dy;
      if (h.includes('w')) { w = g.w - dx; x = g.x + dx; }
      if (h.includes('n')) { hgt = g.h - dy; y = g.y + dy; }
      if (e.shiftKey && h.length === 2) {
        const ratio = g.w / g.h;
        if (w / hgt > ratio) w = hgt * ratio; else hgt = w / ratio;
        if (h.includes('w')) x = g.x + g.w - w;
        if (h.includes('n')) y = g.y + g.h - hgt;
      }
      if (snap && !e.shiftKey) {
        const t = snapTargets();
        if (h.includes('e')) { const s = snapValue([x + w], t.v); if (s) { w += s.delta; gv.push(s.at); } }
        if (h.includes('w')) { const s = snapValue([x], t.v); if (s) { x += s.delta; w -= s.delta; gv.push(s.at); } }
        if (h.includes('s')) { const s = snapValue([y + hgt], t.h); if (s) { hgt += s.delta; gh.push(s.at); } }
        if (h.includes('n')) { const s = snapValue([y], t.h); if (s) { y += s.delta; hgt -= s.delta; gh.push(s.at); } }
      }
      if (w < 8) { if (h.includes('w')) x -= 8 - w; w = 8; }
      if (hgt < 8) { if (h.includes('n')) y -= 8 - hgt; hgt = 8; }
      next.set(id, { ...g, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hgt) });
    } else if (drag.kind === 'rotate') {
      const [id, g] = [...drag.orig.entries()][0] ?? [];
      if (!id || !g) return;
      const cx = g.x + g.w / 2;
      const cy = g.y + g.h / 2;
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((Math.round(deg) % 360) + 360) % 360;
      next.set(id, { ...g, rotation: deg });
    }
    setGuides({ v: gv, h: gh });
    setLive(next);
    setDrag({ ...drag, moved: true });
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === 'marquee' && marquee) {
      const inside = objects.filter((o) => !o.locked && o.x >= marquee.x && o.y >= marquee.y && o.x + o.w <= marquee.x + marquee.w && o.y + o.h <= marquee.y + marquee.h).map((o) => o.id);
      select({ objectIds: drag.additive ? [...new Set([...selectedIds, ...inside])] : inside });
    }
    if (live && drag.moved) {
      const changes = live;
      const label = drag.kind === 'move' ? 'Move' : drag.kind === 'rotate' ? 'Rotate' : 'Resize';
      edit(label, (c, sel) => {
        const sl = findSlide(c, sel.slideId)!;
        for (const l of sl.layers) for (const o of l.objects) {
          const g = changes.get(o.id);
          if (g) Object.assign(o, g);
        }
      });
    }
    setDrag(null);
    setLive(null);
    setMarquee(null);
    setGuides({ v: [], h: [] });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toSlide(e);
    const o = hit(p.x, p.y);
    if (o && textKinds.has(o.kind)) { select({ objectIds: [o.id] }); setEditing(o.id); }
  };

  const editingObj = editing ? layer.objects.find((o) => o.id === editing) : null;
  const primary = selectedIds.length === 1 ? objects.find((o) => o.id === selectedIds[0]) : null;

  return (
    <div className="stage" ref={stageRef} onPointerDown={(e) => { if (e.target === e.currentTarget) select({ objectIds: [] }); }}>
      <div ref={canvasRef} className={`canvas ${grid ? 'grid-on' : ''}`}
        style={{ width: W * scale, height: H * scale, backgroundSize: grid ? `${20 * scale}px ${20 * scale}px` : undefined }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        role="application" aria-label={`Slide canvas: ${slide.title}. ${layer.base ? 'Base layer' : `Layer ${layer.name}`}. Use the Objects list in the inspector or Tab to reach objects with the keyboard.`}>
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <SlideView course={live ? withLive(course, slide.id, live) : course} slide={live ? findSlide(withLive(course, slide.id, live), slide.id)! : slide}
            mode="edit" layerIds={layer.base ? [] : [layer.id]} dimBase={!layer.base} previewStates={previewStates} />
          {grid && <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(to right,#8883 1px,transparent 1px),linear-gradient(to bottom,#8883 1px,transparent 1px)', backgroundSize: '20px 20px' }} />}
        </div>
        {objects.filter((o) => selectedIds.includes(o.id)).map((o) => {
          const g = geom(o);
          const isPrimary = primary?.id === o.id;
          return (
            <div key={o.id} className={`sel-box ${isPrimary ? 'primary' : ''}`}
              style={{ left: g.x * scale, top: g.y * scale, width: g.w * scale, height: g.h * scale, transform: g.rotation ? `rotate(${g.rotation}deg)` : undefined }}>
              {isPrimary && !o.locked && !editing && (
                <>
                  {HANDLES.map((h) => (
                    <span key={h} data-handle={h} className="handle" style={handleStyle(h)} aria-hidden="true" />
                  ))}
                  <span data-handle="rot" className="handle" aria-hidden="true" title="Rotate (Shift snaps to 15°)"
                    style={{ left: '50%', top: -26, marginLeft: -5, borderRadius: '50%', cursor: 'grab' }} />
                </>
              )}
            </div>
          );
        })}
        {marquee && <div className="marquee" style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }} />}
        {guides.v.map((x, i) => <div key={`v${i}`} className="guide" style={{ left: x * scale, top: 0, width: 1, height: H * scale }} />)}
        {guides.h.map((y, i) => <div key={`h${i}`} className="guide" style={{ top: y * scale, left: 0, height: 1, width: W * scale }} />)}
        {editingObj && <InlineText o={editingObj} scale={scale} onDone={() => setEditing(null)} />}
      </div>
    </div>
  );
}

function handleStyle(h: Handle): React.CSSProperties {
  const s: React.CSSProperties = { cursor: `${h}-resize` };
  if (h.includes('n')) s.top = -5; else if (h.includes('s')) s.bottom = -5; else s.top = 'calc(50% - 5px)';
  if (h.includes('w')) s.left = -5; else if (h.includes('e')) s.right = -5; else s.left = 'calc(50% - 5px)';
  return s;
}

function withLive(course: import('../model/types.ts').Course, slideId: ID, live: Map<ID, { x: number; y: number; w: number; h: number; rotation: number }>) {
  return {
    ...course,
    scenes: course.scenes.map((sc) => ({
      ...sc,
      slides: sc.slides.map((sl) => sl.id !== slideId ? sl : {
        ...sl,
        layers: sl.layers.map((l) => ({ ...l, objects: l.objects.map((o) => (live.has(o.id) ? { ...o, ...live.get(o.id)! } : o)) })),
      }),
    })),
  };
}

function InlineText({ o, scale, onDone }: { o: SlideObject; scale: number; onDone: () => void }) {
  const { editSelected } = useEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(o.text);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { if (text !== o.text) editSelected('Edit text', (x) => { if (x.id === o.id) x.text = text; }); onDone(); };
  const s = o.style;
  return (
    <textarea ref={ref} className="text-editor" aria-label={`Text of ${o.name}`} value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onDone(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      }}
      style={{
        left: o.x * scale, top: o.y * scale, width: o.w * scale, height: o.h * scale,
        fontSize: s.fontSize * scale, fontWeight: s.fontWeight, lineHeight: s.lineHeight, color: s.color === 'transparent' ? 'inherit' : s.color,
        textAlign: s.align, padding: s.padding * scale, background: o.style.fill === 'transparent' ? 'color-mix(in srgb, var(--bg) 85%, transparent)' : o.style.fill,
        fontFamily: s.fontFamily === 'mono' ? 'var(--mono)' : 'var(--sans)',
      }} />
  );
}
