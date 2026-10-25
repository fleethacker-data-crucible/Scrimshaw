// Renders one slide at its native size. The same component draws the editor canvas, thumbnails
// and the player, so authoring and playback cannot drift apart.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { interpolate, stateOf, type PlayerState } from '../engine/runtime.ts';
import type { Course, ID, Layer, Slide, SlideObject, Style } from '../model/types.ts';
import { RichText } from './inline.tsx';
import { cueAt, parseVtt, vttFromDataUrl } from './vtt.ts';

export type ViewMode = 'edit' | 'play' | 'thumb';

export function resolveSrc(course: Course, src: string): string {
  if (src.startsWith('asset:')) return course.assets[src.slice(6)]?.data ?? '';
  return src;
}

export function effectiveStyle(o: SlideObject, state: string, transient: 'hover' | 'down' | null): { style: Style; text: string | null } {
  let style = o.style;
  let text: string | null = null;
  const apply = (name: string) => {
    const st = o.states.find((s) => s.name === name);
    if (st) { style = { ...style, ...st.style }; if (st.text !== null) text = st.text; }
  };
  if (state !== 'Normal' && state !== 'Hidden') apply(state);
  if (transient && state !== 'Disabled') {
    apply('Hover');
    if (transient === 'down') apply('Down');
  }
  return { style, text };
}

function textCss(s: Style): CSSProperties {
  return {
    color: s.color,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontFamily: s.fontFamily === 'mono' ? 'var(--mono)' : 'var(--sans)',
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: s.underline ? 'underline' : undefined,
    textAlign: s.align,
    justifyContent: s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start',
    padding: s.padding,
    lineHeight: s.lineHeight,
  };
}

function boxCss(o: SlideObject, s: Style): CSSProperties {
  const round = o.shape === 'ellipse' ? '50%' : o.kind === 'shape' && o.shape === 'rect' ? 0 : s.radius;
  const svgShape = o.kind === 'shape' && (o.shape === 'triangle' || o.shape === 'arrow' || o.shape === 'line');
  return {
    left: o.x, top: o.y, width: o.w, height: o.h,
    transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
    opacity: s.opacity,
    background: svgShape ? undefined : s.fill,
    border: !svgShape && s.strokeWidth > 0 ? `${s.strokeWidth}px solid ${s.stroke}` : undefined,
    borderRadius: round,
    boxShadow: s.shadow ? '0 6px 20px rgba(0,0,0,.28)' : undefined,
  };
}

function ShapeSvg({ o, s }: { o: SlideObject; s: Style }) {
  const sw = s.strokeWidth;
  const w = o.w;
  const h = o.h;
  let d = '';
  if (o.shape === 'triangle') d = `M ${w / 2} ${sw} L ${w - sw} ${h - sw} L ${sw} ${h - sw} Z`;
  if (o.shape === 'arrow') {
    const head = Math.min(w * 0.4, h);
    d = `M ${sw} ${h * 0.3} H ${w - head} V ${sw} L ${w - sw} ${h / 2} L ${w - head} ${h - sw} V ${h * 0.7} H ${sw} Z`;
  }
  if (o.shape === 'line') {
    return (
      <svg width={w} height={h} className="absolute inset-0 overflow-visible" aria-hidden="true">
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={s.stroke === 'transparent' ? s.fill : s.stroke} strokeWidth={Math.max(1, sw)} />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} className="absolute inset-0" aria-hidden="true">
      <path d={d} fill={s.fill} stroke={sw > 0 ? s.stroke : 'none'} strokeWidth={sw} strokeLinejoin="round" />
    </svg>
  );
}

function SpeakerGlyph({ color, playing }: { color: string; playing?: boolean }) {
  return (
    <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" fill={playing ? color : 'none'} />
      <path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
    </svg>
  );
}

/** A <track> needs a same-origin URL, so embedded captions become a blob: URL. */
function useTrackUrl(course: Course, ref: string): string | null {
  const src = ref ? resolveSrc(course, ref) : '';
  const url = useMemo(() => {
    if (!src) return null;
    const text = vttFromDataUrl(src);
    if (text === null) return src;
    try { return URL.createObjectURL(new Blob([text], { type: 'text/vtt' })); } catch { return null; }
  }, [src]);
  useEffect(() => () => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); }, [url]);
  return url;
}

function VideoView({ course, o, src, play, mediaRef }: { course: Course; o: SlideObject; src: string; play: boolean; mediaRef?: (id: ID, el: HTMLMediaElement | null) => void }) {
  const track = useTrackUrl(course, o.captions);
  return (
    <video ref={(el) => mediaRef?.(o.id, el)} src={src} controls={o.controls && play} autoPlay={play && o.autoplay} loop={o.loop} playsInline preload="metadata"
      className="block w-full h-full" style={{ pointerEvents: play ? undefined : 'none' }} aria-label={o.alt || o.name}>
      {track && <track kind="captions" src={track} srcLang="en" label="Captions" default />}
    </video>
  );
}

/** Audio in the player: an <audio> element, plus a play/pause button when the author asked for one,
 *  plus a caption bar at the foot of the slide while captions are available and the audio plays. */
function AudioObject({ course, o, src, css, s, mediaRef, label }: { course: Course; o: SlideObject; src: string; css: CSSProperties; s: Style; mediaRef?: (id: ID, el: HTMLMediaElement | null) => void; label: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [caption, setCaption] = useState('');
  const cues = useMemo(() => {
    const text = o.captions ? vttFromDataUrl(resolveSrc(course, o.captions)) : null;
    return text ? parseVtt(text) : [];
  }, [course, o.captions]);
  const audio = src ? (
    <audio ref={(el) => { ref.current = el; mediaRef?.(o.id, el); }} src={src} autoPlay={o.autoplay} loop={o.loop} preload="auto"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCaption(''); }}
      onTimeUpdate={(e) => { if (cues.length) setCaption(cueAt(cues, (e.target as HTMLAudioElement).currentTime)); }} />
  ) : null;
  const bar = caption ? (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-4 max-w-[80%] px-3 py-1.5 rounded text-center whitespace-pre-line"
      style={{ background: 'rgba(0,0,0,.78)', color: '#fff', fontSize: 22, lineHeight: 1.3, zIndex: 30, pointerEvents: 'none' }} aria-live="off">{caption}</div>
  ) : null;
  if (!o.controls) return <>{audio}{bar}</>;
  return (
    <>
    <div className="obj obj-audio" style={{ ...css, pointerEvents: 'auto' }} role="button" tabIndex={0} aria-pressed={playing}
      aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
      onClick={() => { const a = ref.current; if (a) { if (a.paused) void a.play().catch(() => {}); else a.pause(); } }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-full h-full grid place-items-center"><SpeakerGlyph color={s.color} playing={playing} /></div>
      {audio}
    </div>
    {bar}
    </>
  );
}

interface Handlers {
  onClick?: (id: ID) => void;
  onHover?: (id: ID, entering: boolean) => void;
  onInput?: (id: ID, text: string) => void;
  /** Drag and drop: targetId null means dropped outside every target. */
  onDrop?: (id: ID, targetId: ID | null) => void;
}

/** Drag-and-drop wiring for one object, computed by SlideView. */
interface DragWiring {
  pos: { x: number; y: number } | null;
  lifted: boolean;
  props: Record<string, unknown>;
}

function ObjectView({ course, o, mode, state, text, transient, onPointer, handlers, inputValue, animate, mediaRef, drag, exiting }: {
  course: Course; o: SlideObject; mode: ViewMode; state: string; text: (t: string) => string; transient: 'hover' | 'down' | null;
  onPointer: (id: ID, t: 'hover' | 'down' | null) => void; handlers: Handlers; inputValue: string; animate: boolean;
  mediaRef?: (id: ID, el: HTMLMediaElement | null) => void; drag?: DragWiring; exiting?: boolean;
}) {
  const { style: s, text: stateText } = effectiveStyle(o, state, mode === 'play' ? transient : null);
  const css = boxCss(o, s);
  if (drag?.pos) { css.left = drag.pos.x; css.top = drag.pos.y; }
  if (drag?.lifted) { css.zIndex = 20; css.boxShadow = '0 10px 24px rgba(0,0,0,.35)'; css.cursor = 'grabbing'; css.transition = 'none'; }
  else if (drag && mode === 'play' && o.draggable) css.transition = 'left .15s ease-out, top .15s ease-out';
  const play = mode === 'play';
  const disabled = state === 'Disabled';
  if (play && exiting && o.exit.type !== 'none') {
    // Exit = the matching entrance keyframes played backwards.
    css.animation = `scr-${o.exit.type} ${o.exit.duration}s ease-in reverse both`;
  } else if (play && animate && o.enter.type !== 'none') {
    css.animation = `scr-${o.enter.type} ${o.enter.duration}s ease-out both`;
  }
  const content = text(stateText ?? o.text);
  const interactive = play && !disabled && !o.draggable && (o.kind === 'button' || o.kind === 'hotspot' || o.kind === 'choice' || o.triggers.some((t) => t.event.type === 'click'));
  const a11y: Record<string, unknown> = {};
  if (play && o.decorative) a11y['aria-hidden'] = true;
  if (interactive || (play && o.kind === 'choice')) {
    a11y.tabIndex = disabled ? -1 : 0;
    a11y.role = o.kind === 'choice' ? (o.choiceMode === 'radio' ? 'radio' : 'checkbox') : 'button';
    if (o.kind === 'choice') a11y['aria-checked'] = state === 'Selected';
    if (o.kind === 'hotspot' && state === 'Selected') a11y['aria-pressed'] = true;
    if (o.kind === 'hotspot' || (o.kind !== 'button' && o.kind !== 'choice' && !content.trim())) a11y['aria-label'] = o.alt || o.name;
    a11y.onClick = () => handlers.onClick?.(o.id);
    a11y.onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onClick?.(o.id); } };
  }
  if (play && disabled) a11y['aria-disabled'] = true;
  const pointer = play && !disabled && !o.draggable ? {
    onPointerEnter: () => { onPointer(o.id, 'hover'); handlers.onHover?.(o.id, true); },
    onPointerLeave: () => { onPointer(o.id, null); handlers.onHover?.(o.id, false); },
    onPointerDown: () => onPointer(o.id, 'down'),
    onPointerUp: () => onPointer(o.id, 'hover'),
  } : {};

  let inner: ReactNode = null;
  switch (o.kind) {
    case 'image': {
      const src = resolveSrc(course, o.src);
      inner = src
        ? <img src={src} alt={o.decorative ? '' : o.alt} draggable={false} className="block w-full h-full" style={{ objectFit: 'fill', borderRadius: 'inherit' }} />
        : <div className="w-full h-full grid place-items-center text-[13px]" style={{ background: '#8882', color: '#666' }}>Image</div>;
      break;
    }
    case 'video': {
      const src = resolveSrc(course, o.src);
      inner = src && mode !== 'thumb'
        ? <VideoView course={course} o={o} src={src} play={play} mediaRef={mediaRef} />
        : <div className="w-full h-full grid place-items-center text-[13px]" style={{ color: '#aaa' }}>Video</div>;
      break;
    }
    case 'audio': {
      const src = resolveSrc(course, o.src);
      if (play) {
        return <AudioObject course={course} o={o} src={src} css={css} s={s} mediaRef={mediaRef} label={o.alt || o.name} />;
      }
      inner = (
        <div className="w-full h-full grid place-items-center" title={`${o.name}${o.controls ? '' : ' (invisible to learners)'}`}>
          <SpeakerGlyph color={s.color} />
        </div>
      );
      if (!o.controls && mode === 'edit') css.outline = '1px dashed #9a988f';
      if (mode === 'thumb' && !o.controls) return null;
      break;
    }
    case 'input':
      inner = play
        ? o.multiline
          ? <textarea className="obj-input" style={{ ...textCss(s), padding: 10, resize: 'none', whiteSpace: 'pre-wrap' }} value={inputValue} placeholder={content}
              aria-label={o.alt || content || o.name} disabled={disabled} onChange={(e) => handlers.onInput?.(o.id, e.target.value)} />
          : <input className="obj-input" style={textCss(s)} value={inputValue} placeholder={content} aria-label={o.alt || content || o.name}
              disabled={disabled} onChange={(e) => handlers.onInput?.(o.id, e.target.value)} />
        : <div className="obj-text" style={{ ...textCss(s), opacity: 0.6 }}>{content}</div>;
      break;
    case 'slider': {
      const lo = Number.isFinite(o.min) ? o.min : 0;
      const hi = Number.isFinite(o.max) && o.max > lo ? o.max : lo + 10;
      const step = o.step > 0 ? o.step : 1;
      const raw = Number(inputValue);
      const value = inputValue !== '' && Number.isFinite(raw) ? Math.min(hi, Math.max(lo, raw)) : lo;
      inner = play
        ? <input type="range" className="w-full h-full" min={lo} max={hi} step={step} value={value} disabled={disabled}
            style={{ accentColor: s.fill === 'transparent' ? undefined : s.fill, margin: 0 }}
            aria-label={o.alt || o.name} aria-valuetext={String(value)} onChange={(e) => handlers.onInput?.(o.id, e.target.value)} />
        : (
          <div className="w-full h-full relative" aria-hidden="true">
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -mt-[3px] rounded-full" style={{ background: '#9a988f55' }} />
            <div className="absolute top-1/2 -mt-[9px] w-[18px] h-[18px] rounded-full" style={{ left: 0, background: s.fill === 'transparent' ? '#2f74c8' : s.fill }} />
          </div>
        );
      break;
    }
    case 'choice': {
      const selected = state === 'Selected';
      inner = (
        <div className="obj-text" style={{ ...textCss(s), flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <span className={`mark ${o.choiceMode === 'radio' ? 'radio' : 'check'}`}>{selected && <i />}</span>
          <span className="flex-1"><RichText text={content} /></span>
        </div>
      );
      break;
    }
    case 'hotspot':
      inner = null;
      if (play && state === 'Selected' && !o.states.some((x) => x.name === 'Selected')) {
        css.outline = '3px solid #e8c15a';
        css.background = 'rgba(232,193,90,.18)';
      }
      break;
    default:
      inner = (
        <>
          {o.kind === 'shape' && (o.shape === 'triangle' || o.shape === 'arrow' || o.shape === 'line') && <ShapeSvg o={o} s={s} />}
          {content && <div className="obj-text relative" style={textCss(s)}><RichText text={content} /></div>}
        </>
      );
  }
  if (play) css.pointerEvents = 'auto';
  if (mode === 'edit' && o.initiallyHidden) { css.opacity = (s.opacity ?? 1) * 0.45; css.outline = '1px dashed #9a988f'; }
  return (
    <div className={`obj obj-${o.kind}${mode === 'edit' && o.kind === 'hotspot' ? ' hotspot-edit' : ''}`} style={css} data-id={o.id}
      title={mode === 'edit' && o.initiallyHidden ? `${o.name} starts hidden` : undefined} {...a11y} {...pointer} {...(play && !disabled ? drag?.props : {})}>
      {inner}
    </div>
  );
}

export interface SlideViewProps extends Handlers {
  course: Course;
  slide: Slide;
  mode: ViewMode;
  /** Non-base layers to draw, bottom to top. */
  layerIds: ID[];
  /** Player state (play mode). */
  state?: PlayerState;
  /** Seconds elapsed on each visible layer's timeline (play mode); objects appear at their start time. */
  times?: Record<ID, number>;
  /** Edit mode: preview an object in a state. */
  previewStates?: Record<ID, string>;
  /** Edit mode: dim the base layer while editing another layer. */
  dimBase?: boolean;
  mediaRef?: (id: ID, el: HTMLMediaElement | null) => void;
  className?: string;
  style?: CSSProperties;
}

export function SlideView(p: SlideViewProps) {
  const { course, slide, mode } = p;
  const [pointer, setPointer] = useState<{ id: ID; t: 'hover' | 'down' } | null>(null);
  const [dragging, setDragging] = useState<{ id: ID; cx: number; cy: number; dx: number; dy: number; moved: boolean } | null>(null);
  const [grabbed, setGrabbed] = useState<ID | null>(null);
  const [announce, setAnnounce] = useState('');
  const el = useRef<HTMLDivElement>(null);
  const st = p.state;
  const play = mode === 'play' && !!st;
  const allObjs = slide.layers.flatMap((l) => l.objects);
  const visibleNow = (o: SlideObject) => !st || stateOf(st, o) !== 'Hidden';
  const restPos = (o: SlideObject): { x: number; y: number } => {
    const base = st?.positions[o.id] ?? { x: o.x, y: o.y };
    const tid = st?.drops[o.id];
    const t = tid ? allObjs.find((x) => x.id === tid) : undefined;
    if (!t) return base;
    const tp = st?.positions[t.id] ?? { x: t.x, y: t.y };
    // Snap to the target's right end so its label (left) stays readable; centre when there is no room.
    const pad = Math.max(6, Math.round((t.h - o.h) / 2));
    const x = o.w + pad * 2 <= t.w * 0.75 ? tp.x + t.w - o.w - pad : tp.x + t.w / 2 - o.w / 2;
    return { x: Math.round(x), y: Math.round(tp.y + t.h / 2 - o.h / 2) };
  };
  const targetAt = (x: number, y: number, except: ID): SlideObject | null => {
    for (let i = allObjs.length - 1; i >= 0; i--) {
      const t = allObjs[i];
      if (!t.dropTarget || t.id === except || !visibleNow(t)) continue;
      const tp = st?.positions[t.id] ?? { x: t.x, y: t.y };
      if (x >= tp.x && x <= tp.x + t.w && y >= tp.y && y <= tp.y + t.h) return t;
    }
    return null;
  };
  const label = (o: SlideObject) => (o.text ? interpolate(o.text, course, st!) : '') || o.alt || o.name;
  const dragWiring = (o: SlideObject): DragWiring | undefined => {
    if (!play) return undefined;
    if (o.draggable) {
      const rest = restPos(o);
      const live = dragging?.id === o.id ? { x: rest.x + dragging.dx, y: rest.y + dragging.dy } : rest;
      const scale = () => (el.current ? el.current.getBoundingClientRect().width / course.size.w : 1);
      return {
        pos: live.x !== o.x || live.y !== o.y ? live : null,
        lifted: dragging?.id === o.id && dragging.moved,
        props: {
          role: 'button', tabIndex: 0, 'aria-roledescription': 'draggable item', 'aria-pressed': grabbed === o.id,
          'aria-label': `${label(o)}${st!.drops[o.id] ? `, on ${label(allObjs.find((x) => x.id === st!.drops[o.id])!)}` : ''}. Press Enter to pick up.`,
          onPointerDown: (e: RPointerEvent) => {
            if (e.button !== 0) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDragging({ id: o.id, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0, moved: false });
          },
          onPointerMove: (e: RPointerEvent) => {
            if (dragging?.id !== o.id) return;
            const k = scale();
            const dx = (e.clientX - dragging.cx) / k;
            const dy = (e.clientY - dragging.cy) / k;
            setDragging({ ...dragging, dx, dy, moved: dragging.moved || Math.abs(dx) + Math.abs(dy) > 4 });
          },
          onPointerUp: () => {
            if (dragging?.id !== o.id) return;
            const d = dragging;
            setDragging(null);
            if (!d.moved) { p.onClick?.(o.id); return; }
            const t = targetAt(rest.x + d.dx + o.w / 2, rest.y + d.dy + o.h / 2, o.id);
            p.onDrop?.(o.id, t?.id ?? null);
            setAnnounce(t ? `Dropped ${label(o)} on ${label(t)}.` : `${label(o)} returned.`);
          },
          onPointerCancel: () => setDragging(null),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (grabbed === o.id) { setGrabbed(null); setAnnounce(`Put down ${label(o)}.`); }
              else { setGrabbed(o.id); setAnnounce(`Picked up ${label(o)}. Tab to a drop target and press Enter, or press Escape to cancel.`); }
            } else if (e.key === 'Escape' && grabbed) { setGrabbed(null); setAnnounce('Cancelled.'); }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && st!.drops[o.id]) { p.onDrop?.(o.id, null); setAnnounce(`${label(o)} returned.`); }
          },
        },
      };
    }
    if (o.dropTarget && grabbed) {
      const item = allObjs.find((x) => x.id === grabbed);
      return {
        pos: st!.positions[o.id] ?? null, lifted: false,
        props: {
          role: 'button', tabIndex: 0, 'aria-label': `Drop ${item ? label(item) : 'item'} on ${label(o)}`,
          onClick: () => { if (grabbed) { p.onDrop?.(grabbed, o.id); setAnnounce(`Dropped ${item ? label(item) : 'item'} on ${label(o)}.`); setGrabbed(null); } },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onDrop?.(grabbed, o.id); setAnnounce(`Dropped ${item ? label(item) : 'item'} on ${label(o)}.`); setGrabbed(null); }
            if (e.key === 'Escape') { setGrabbed(null); setAnnounce('Cancelled.'); }
          },
        },
      };
    }
    const pos = st!.positions[o.id];
    return pos ? { pos, lifted: false, props: {} } : undefined;
  };
  const onPointer = (id: ID, t: 'hover' | 'down' | null) => setPointer(t ? { id, t } : (pointer?.id === id ? null : pointer));
  const text = (t: string) => (p.state ? interpolate(t, course, p.state) : t);
  const layers: Layer[] = [slide.layers[0], ...p.layerIds.map((id) => slide.layers.find((l) => l.id === id)).filter((l): l is Layer => !!l && !l.base)];
  const modalOn = mode === 'play' && layers.some((l) => !l.base && l.modal);

  return (
    <div ref={el} className={`slide ${p.className ?? ''}`} style={{ width: course.size.w, height: course.size.h, background: slide.background.startsWith('asset:') ? `center / cover url(${resolveSrc(course, slide.background)})` : slide.background, ...p.style }}>
      {slide.useMaster && course.master && course.master.id !== slide.id && course.master.layers[0].objects.length > 0 && (
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }} aria-hidden={mode !== 'play' || undefined} data-master="">
          {course.master.layers[0].objects.map((o) => (mode === 'edit' && o.editorHidden ? null : (
            <ObjectView key={o.id} course={course} o={{ ...o, triggers: [] }} mode={mode === 'play' ? 'thumb' : mode} state="Normal" text={text}
              transient={null} onPointer={() => {}} handlers={{}} inputValue="" animate={false} />
          )))}
        </div>
      )}
      {layers.map((layer, li) => {
        const t = p.times?.[layer.id] ?? Infinity;
        const isBaseUnderModal = modalOn && layer.base;
        const topModal = mode === 'play' && !layer.base && layer.modal && li === layers.length - 1;
        return (
          <div key={layer.id} className="absolute inset-0" data-layer={layer.id} inert={isBaseUnderModal || (modalOn && !layer.base && !topModal) || undefined}
            style={{ pointerEvents: 'none' }}>
            {topModal && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.35)', pointerEvents: 'auto' }} />}
            {layer.objects.map((o) => {
              if (mode === 'edit' && o.editorHidden) return null;
              let st = 'Normal';
              if (mode === 'play' && p.state) {
                st = stateOf(p.state, o);
                if (st === 'Hidden') return null;
                if (t < o.start) return null;
                if (o.end !== null && t >= o.end && !(o.exit.type !== 'none' && t < o.end + o.exit.duration)) return null;
              } else if (mode === 'edit' && p.previewStates?.[o.id]) {
                st = p.previewStates[o.id];
              }
              const inputValue = (o.kind === 'input' || o.kind === 'slider') && p.state
                ? (p.state.inputs[o.id] ?? (o.variableId ? String(p.state.vars[o.variableId] ?? '') : ''))
                : '';
              return (
                <ObjectView key={o.id} course={course} o={o} mode={mode} state={st} text={text}
                  transient={pointer?.id === o.id ? pointer.t : null} onPointer={onPointer} handlers={p}
                  inputValue={inputValue} animate={mode === 'play'} mediaRef={p.mediaRef} drag={dragWiring(o)}
                  exiting={mode === 'play' && o.end !== null && t >= o.end} />
              );
            })}
            {layer.base && p.dimBase && <div className="layer-dim" />}
          </div>
        );
      })}
      {play && <div className="sr-only" aria-live="assertive">{announce}</div>}
    </div>
  );
}

/** A slide drawn at a fixed width (thumbnails, story view). Re-renders only when that slide's
 *  content, the media it can use, or the slide size changes: every edit clones the course, so
 *  identity alone would redraw every thumbnail on every keystroke. */
export const SlideThumb = memo(SlideThumbInner, (a, b) =>
  a.width === b.width && a.course.assets === b.course.assets &&
  a.course.size.w === b.course.size.w && a.course.size.h === b.course.size.h &&
  (a.course.master === b.course.master || JSON.stringify(a.course.master) === JSON.stringify(b.course.master)) &&
  (a.slide === b.slide || JSON.stringify(a.slide) === JSON.stringify(b.slide)));

function SlideThumbInner({ course, slide, width }: { course: Course; slide: Slide; width: number }) {
  const scale = width / course.size.w;
  return (
    <div style={{ width, height: course.size.h * scale, overflow: 'hidden', position: 'relative' }} aria-hidden="true">
      <SlideView course={course} slide={slide} mode="thumb" layerIds={[]} style={{ transform: `scale(${scale})` }} />
    </div>
  );
}
