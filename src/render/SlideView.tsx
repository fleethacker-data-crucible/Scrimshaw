// Renders one slide at its native size. The same component draws the editor canvas, thumbnails
// and the player, so authoring and playback cannot drift apart.
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { interpolate, stateOf, type PlayerState } from '../engine/runtime.ts';
import type { Course, ID, Layer, Slide, SlideObject, Style } from '../model/types.ts';

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

interface Handlers {
  onClick?: (id: ID) => void;
  onHover?: (id: ID, entering: boolean) => void;
  onInput?: (id: ID, text: string) => void;
}

function ObjectView({ course, o, mode, state, text, transient, onPointer, handlers, inputValue, animate, mediaRef }: {
  course: Course; o: SlideObject; mode: ViewMode; state: string; text: (t: string) => string; transient: 'hover' | 'down' | null;
  onPointer: (id: ID, t: 'hover' | 'down' | null) => void; handlers: Handlers; inputValue: string; animate: boolean;
  mediaRef?: (id: ID, el: HTMLVideoElement | null) => void;
}) {
  const { style: s, text: stateText } = effectiveStyle(o, state, mode === 'play' ? transient : null);
  const css = boxCss(o, s);
  const play = mode === 'play';
  const disabled = state === 'Disabled';
  if (play && animate && o.enter.type !== 'none') {
    css.animation = `scr-${o.enter.type} ${o.enter.duration}s ease-out both`;
  }
  const content = text(stateText ?? o.text);
  const interactive = play && !disabled && (o.kind === 'button' || o.kind === 'hotspot' || o.kind === 'choice' || o.triggers.some((t) => t.event.type === 'click'));
  const a11y: Record<string, unknown> = {};
  if (play && o.decorative) a11y['aria-hidden'] = true;
  if (interactive || (play && o.kind === 'choice')) {
    a11y.tabIndex = disabled ? -1 : 0;
    a11y.role = o.kind === 'choice' ? (o.choiceMode === 'radio' ? 'radio' : 'checkbox') : 'button';
    if (o.kind === 'choice') a11y['aria-checked'] = state === 'Selected';
    if (o.kind === 'hotspot' || (o.kind !== 'button' && o.kind !== 'choice' && !content.trim())) a11y['aria-label'] = o.alt || o.name;
    a11y.onClick = () => handlers.onClick?.(o.id);
    a11y.onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onClick?.(o.id); } };
  }
  if (play && disabled) a11y['aria-disabled'] = true;
  const pointer = play && !disabled ? {
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
        ? <video ref={(el) => mediaRef?.(o.id, el)} src={src} controls={o.controls && play} autoPlay={play && o.autoplay} playsInline preload="metadata"
            className="block w-full h-full" style={{ pointerEvents: play ? undefined : 'none' }} aria-label={o.alt || o.name} />
        : <div className="w-full h-full grid place-items-center text-[13px]" style={{ color: '#aaa' }}>Video</div>;
      break;
    }
    case 'input':
      inner = play
        ? <input className="obj-input" style={textCss(s)} value={inputValue} placeholder={content} aria-label={o.alt || content || o.name}
            disabled={disabled} onChange={(e) => handlers.onInput?.(o.id, e.target.value)} />
        : <div className="obj-text" style={{ ...textCss(s), opacity: 0.6 }}>{content}</div>;
      break;
    case 'choice': {
      const selected = state === 'Selected';
      inner = (
        <div className="obj-text" style={{ ...textCss(s), flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <span className={`mark ${o.choiceMode === 'radio' ? 'radio' : 'check'}`}>{selected && <i />}</span>
          <span className="flex-1">{content}</span>
        </div>
      );
      break;
    }
    case 'hotspot':
      inner = null;
      break;
    default:
      inner = (
        <>
          {o.kind === 'shape' && (o.shape === 'triangle' || o.shape === 'arrow' || o.shape === 'line') && <ShapeSvg o={o} s={s} />}
          {content && <div className="obj-text relative" style={textCss(s)}>{content}</div>}
        </>
      );
  }
  if (play) css.pointerEvents = 'auto';
  if (mode === 'edit' && o.initiallyHidden) { css.opacity = (s.opacity ?? 1) * 0.45; css.outline = '1px dashed #9a988f'; }
  return (
    <div className={`obj obj-${o.kind}${mode === 'edit' && o.kind === 'hotspot' ? ' hotspot-edit' : ''}`} style={css} data-id={o.id}
      title={mode === 'edit' && o.initiallyHidden ? `${o.name} starts hidden` : undefined} {...a11y} {...pointer}>
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
  mediaRef?: (id: ID, el: HTMLVideoElement | null) => void;
  className?: string;
  style?: CSSProperties;
}

export function SlideView(p: SlideViewProps) {
  const { course, slide, mode } = p;
  const [pointer, setPointer] = useState<{ id: ID; t: 'hover' | 'down' } | null>(null);
  const onPointer = (id: ID, t: 'hover' | 'down' | null) => setPointer(t ? { id, t } : (pointer?.id === id ? null : pointer));
  const text = (t: string) => (p.state ? interpolate(t, course, p.state) : t);
  const layers: Layer[] = [slide.layers[0], ...p.layerIds.map((id) => slide.layers.find((l) => l.id === id)).filter((l): l is Layer => !!l && !l.base)];
  const modalOn = mode === 'play' && layers.some((l) => !l.base && l.modal);

  return (
    <div className={`slide ${p.className ?? ''}`} style={{ width: course.size.w, height: course.size.h, background: slide.background.startsWith('asset:') ? `center / cover url(${resolveSrc(course, slide.background)})` : slide.background, ...p.style }}>
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
                if (t < o.start || (o.end !== null && t >= o.end)) return null;
              } else if (mode === 'edit' && p.previewStates?.[o.id]) {
                st = p.previewStates[o.id];
              }
              const inputValue = o.kind === 'input' && p.state
                ? (p.state.inputs[o.id] ?? (o.variableId ? String(p.state.vars[o.variableId] ?? '') : ''))
                : '';
              return (
                <ObjectView key={o.id} course={course} o={o} mode={mode} state={st} text={text}
                  transient={pointer?.id === o.id ? pointer.t : null} onPointer={onPointer} handlers={p}
                  inputValue={inputValue} animate={mode === 'play'} mediaRef={p.mediaRef} />
              );
            })}
            {layer.base && p.dimBase && <div className="layer-dim" />}
          </div>
        );
      })}
    </div>
  );
}

/** A slide drawn at a fixed width (thumbnails, story view). */
export function SlideThumb({ course, slide, width }: { course: Course; slide: Slide; width: number }) {
  const scale = width / course.size.w;
  return (
    <div style={{ width, height: course.size.h * scale, overflow: 'hidden', position: 'relative' }} aria-hidden="true">
      <SlideView course={course} slide={slide} mode="thumb" layerIds={[]} style={{ transform: `scale(${scale})` }} />
    </div>
  );
}
