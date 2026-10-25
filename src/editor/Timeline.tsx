import { useRef, useState } from 'react';
import { findLayer, findSlide } from '../model/query.ts';
import type { ID } from '../model/types.ts';
import { Eye, EyeOff, Lock } from '../ui/icons.tsx';
import { IconButton } from '../ui/kit.tsx';
import { useEditor } from './context.tsx';

/** Objects of the editing layer as bars; drag a bar to move it, drag its edges to trim, drag the gold line to set the slide length. */
export function Timeline() {
  const { slide, layer, state, select, edit } = useEditor();
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: ID | 'end'; mode: 'move' | 'start' | 'end' | 'duration'; x0: number; start: number; end: number } | null>(null);
  const [live, setLive] = useState<{ id: ID | 'end'; start: number; end: number } | null>(null);
  const dur = slide.duration;
  const span = Math.max(dur, ...layer.objects.map((o) => o.end ?? 0)) * 1.1 + 0.5;
  const pxPerSec = () => (track.current?.clientWidth ?? 600) / span;
  const snapT = (t: number) => Math.max(0, Math.round(t * 4) / 4);

  const begin = (e: React.PointerEvent, id: ID | 'end', mode: 'move' | 'start' | 'end' | 'duration', start: number, end: number) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, x0: e.clientX, start, end });
    if (id !== 'end') select({ objectIds: [id] });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dt = (e.clientX - drag.x0) / pxPerSec();
    if (drag.mode === 'duration') { setLive({ id: 'end', start: 0, end: Math.max(0.5, snapT(drag.end + dt)) }); return; }
    let { start, end } = drag;
    if (drag.mode === 'move') { const len = end - start; start = snapT(start + dt); end = start + len; }
    if (drag.mode === 'start') start = Math.min(snapT(start + dt), end - 0.25);
    if (drag.mode === 'end') end = Math.max(snapT(end + dt), start + 0.25);
    setLive({ id: drag.id, start, end });
  };
  const up = () => {
    if (drag && live) {
      const l = live;
      if (l.id === 'end') edit('Slide duration', (c, sel) => { findSlide(c, sel.slideId)!.duration = l.end; });
      else edit('Timing', (c, sel) => {
        const o = findLayer(findSlide(c, sel.slideId)!, sel.layerId)!.objects.find((x) => x.id === l.id)!;
        o.start = l.start;
        o.end = l.end >= findSlide(c, sel.slideId)!.duration - 1e-6 ? null : l.end;
      });
    }
    setDrag(null);
    setLive(null);
  };
  const shownDur = live?.id === 'end' ? live.end : dur;
  const ticks = [];
  const step = span > 30 ? 5 : span > 12 ? 2 : 1;
  for (let t = 0; t <= span; t += step) ticks.push(t);

  return (
    <section aria-label="Timeline" className="tl" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="tl-row !h-[22px] sticky top-0 bg-panel z-[1]">
        <div className="nm font-semibold text-fg-2">{layer.base ? 'Timeline' : `Timeline · ${layer.name}`}</div>
        <div className="tl-ruler" ref={track}>
          {ticks.map((t) => <span key={t} className="tl-tick" style={{ left: `${(t / span) * 100}%` }}>{t}s</span>)}
          <span className="tl-end" role="slider" tabIndex={0} aria-label="Slide length" aria-valuemin={0.5} aria-valuemax={3600} aria-valuenow={shownDur}
            aria-valuetext={`${shownDur} seconds`} title={`Slide length ${shownDur}s (drag)`} style={{ left: `${(shownDur / span) * 100}%` }}
            onPointerDown={(e) => begin(e, 'end', 'duration', 0, dur)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' ? 0.5 : e.key === 'ArrowLeft' ? -0.5 : 0;
              if (d) { e.preventDefault(); edit('Slide duration', (c, sel) => { const s = findSlide(c, sel.slideId)!; s.duration = Math.max(0.5, s.duration + d); }, 'dur-key'); }
            }} />
        </div>
      </div>
      {[...layer.objects].reverse().map((o) => {
        const isLive = live?.id === o.id;
        const start = isLive ? live.start : o.start;
        const end = isLive ? live.end : (o.end ?? dur);
        const sel = state.sel.objectIds.includes(o.id);
        return (
          <div key={o.id} className="tl-row" aria-selected={sel} onClick={() => select({ objectIds: [o.id] })}>
            <div className="nm">
              <IconButton label={o.editorHidden ? `Show ${o.name} on canvas` : `Hide ${o.name} on canvas`} className="!h-5 !w-5"
                onClick={(e) => { e.stopPropagation(); edit('Toggle visibility', (c, s) => { findLayer(findSlide(c, s.slideId)!, s.layerId)!.objects.find((x) => x.id === o.id)!.editorHidden = !o.editorHidden; }); }}>
                {o.editorHidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </IconButton>
              {o.locked && <Lock size={11} aria-label="Locked" />}
              <span className="truncate" title={o.name}>{o.name}</span>
            </div>
            <div className="tl-track">
              <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-brand pointer-events-none" style={{ left: `${(shownDur / span) * 100}%` }} />
              <div className="tl-bar" style={{ left: `${(start / span) * 100}%`, width: `${(Math.max(0.1, end - start) / span) * 100}%`, opacity: o.editorHidden ? 0.4 : 1 }}
                role="slider" tabIndex={-1} aria-label={`${o.name} appears at`} aria-valuenow={start} aria-valuetext={`${start} to ${end} seconds`}
                title={`${o.name}: ${start}s – ${o.end === null && !isLive ? 'end' : `${end}s`}`}
                onPointerDown={(e) => begin(e, o.id, 'move', o.start, o.end ?? dur)}>
                <span className="grip" style={{ left: 0 }} onPointerDown={(e) => begin(e, o.id, 'start', o.start, o.end ?? dur)} />
                <span className="grip" style={{ right: 0 }} onPointerDown={(e) => begin(e, o.id, 'end', o.start, o.end ?? dur)} />
              </div>
            </div>
          </div>
        );
      })}
      {layer.objects.length === 0 && <p className="muted p-3">This layer has no objects. Use Insert in the ribbon.</p>}
    </section>
  );
}
