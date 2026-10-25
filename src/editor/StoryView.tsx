// Story view: every scene and slide at a glance, with arrows for where each slide's triggers can
// take the learner (next/previous/jump/scene). Arrows are measured from the laid-out cards.
import { useLayoutEffect, useRef, useState } from 'react';
import { allSlides, slideLinks } from '../model/query.ts';
import type { ID } from '../model/types.ts';
import { SlideThumb } from '../render/SlideView.tsx';
import { useEditor } from './context.tsx';

interface Edge { from: ID; to: ID; label: string }
interface Path { d: string; label: string; lx: number; ly: number; selected: boolean }

export function StoryView({ onOpen }: { onOpen: () => void }) {
  const { course, state, select } = useEditor();
  const flat = allSlides(course);
  const wrap = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<ID, HTMLButtonElement>());
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [showAll, setShowAll] = useState(false);

  const edges: Edge[] = flat.flatMap((sl) => slideLinks(course, sl).map((l) => ({ from: sl.id, to: l.to, label: l.label })));
  const selId = state.sel.slideId;
  const visible = showAll ? edges : edges.filter((e) => e.from === selId || e.to === selId);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const box = (id: ID) => {
        const c = cards.current.get(id);
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: r.left - base.left + el.scrollLeft, y: r.top - base.top + el.scrollTop, w: r.width, h: r.height };
      };
      const out: Path[] = [];
      const seen = new Map<string, number>();
      for (const e of visible) {
        const a = box(e.from);
        const b = box(e.to);
        if (!a || !b || e.from === e.to) continue;
        const pair = `${e.from}>${e.to}`;
        const k = seen.get(pair) ?? 0;
        seen.set(pair, k + 1);
        if (k > 0) continue; // one arrow per pair; the first trigger names it
        const sameRow = Math.abs(a.y - b.y) < 10;
        let d: string;
        let lx: number;
        let ly: number;
        if (sameRow) {
          const forward = b.x > a.x;
          const x1 = forward ? a.x + a.w : a.x;
          const x2 = forward ? b.x : b.x + b.w;
          const y = a.y + (forward ? a.h * 0.32 : a.h * 0.62);
          const adjacent = Math.abs(x2 - x1) < 40;
          const lift = adjacent ? 0 : (forward ? -1 : 1) * Math.min(70, Math.abs(x2 - x1) / 4);
          d = `M ${x1} ${y} C ${x1 + (x2 - x1) / 3} ${y + lift}, ${x1 + (2 * (x2 - x1)) / 3} ${y + lift}, ${x2} ${y}`;
          lx = (x1 + x2) / 2;
          ly = y + lift * 0.75 - 4;
        } else {
          const down = b.y > a.y;
          const x1 = a.x + a.w / 2;
          const y1 = down ? a.y + a.h : a.y;
          const x2 = b.x + b.w / 2;
          const y2 = down ? b.y : b.y + b.h;
          const my = (y1 + y2) / 2;
          d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
          lx = (x1 + x2) / 2;
          ly = my - 4;
        }
        out.push({ d, label: e.label, lx, ly, selected: e.from === selId });
      }
      setPaths(out);
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [course, selId, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = (id: string) => {
    const i = flat.findIndex((s) => s.id === id);
    return i >= 0 ? `${i + 1}. ${flat[i].title}` : 'missing';
  };

  return (
    <div className="story" ref={wrap} aria-label="Story view">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <p className="muted text-[13px] !m-0 flex-1 min-w-0">Click a slide to see where it leads, double-click to edit it. Arrows come from the slide's triggers.</p>
        <label className="check text-[13px]"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every link</label>
      </div>
      {course.scenes.map((sc) => (
        <section key={sc.id} className="story-scene relative" aria-label={sc.name}>
          <h2 className="!mt-0">{sc.name}{sc.bank && <span className="badge purple ml-2">Bank</span>}</h2>
          <div className="story-grid">
            {sc.slides.map((sl) => {
              const out = slideLinks(course, sl);
              return (
                <button key={sl.id} ref={(el) => { if (el) cards.current.set(sl.id, el); else cards.current.delete(sl.id); }}
                  type="button" className="story-card" aria-current={sl.id === selId}
                  aria-label={`${title(sl.id)}. ${out.length ? `Leads to ${out.map((l) => title(l.to)).join(', ')}.` : 'No outgoing links.'}`}
                  onClick={() => select({ slideId: sl.id, objectIds: [] })}
                  onDoubleClick={() => { select({ slideId: sl.id, objectIds: [] }); onOpen(); }}>
                  <SlideThumb course={course} slide={sl} width={162} />
                  <div className="text-[12px] font-semibold mt-1 truncate">{title(sl.id)}</div>
                  <div className="text-[11px] text-muted">
                    {sl.question ? 'Question · ' : ''}{sl.layers.length > 1 ? `${sl.layers.length - 1} layer${sl.layers.length > 2 ? 's' : ''} · ` : ''}{out.length} link{out.length === 1 ? '' : 's'}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <svg className="absolute left-0 top-0 pointer-events-none z-[2]" width={size.w} height={size.h} aria-hidden="true" style={{ overflow: 'visible' }}>
        <defs>
          <marker id="story-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--link)" />
          </marker>
          <marker id="story-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.d} fill="none" stroke={p.selected ? 'var(--link)' : 'var(--muted)'} strokeWidth={p.selected ? 2 : 1.25}
              markerEnd={`url(#${p.selected ? 'story-arrow' : 'story-arrow-dim'})`} strokeDasharray={p.selected ? undefined : '4 3'} />
            {p.selected && (
              <text x={p.lx} y={p.ly} textAnchor="middle" fontSize="11" fill="var(--text-2)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">{p.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
