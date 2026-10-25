// The learner-facing player: slide stage with timeline clock, player chrome (menu, prev/next,
// seekbar), effects (URLs, media, notices) and progress reporting (SCORM or local resume).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as E from '../engine/runtime.ts';
import { findSlide } from '../model/query.ts';
import type { Course, ID } from '../model/types.ts';
import { SlideView } from '../render/SlideView.tsx';
import type { Lms } from '../export/scorm.ts';
import { ChevronLeft, ChevronRight, Menu as MenuIcon, Pause, Play, RotateCcw, X } from '../ui/icons.tsx';
import { Button, IconButton } from '../ui/kit.tsx';

const LOCAL_KEY = (id: ID) => `scrimshaw-progress-${id}`;

function readLocal(id: ID): string | null {
  try { return localStorage.getItem(LOCAL_KEY(id)); } catch { return null; }
}
function writeLocal(id: ID, data: string | null) {
  try { if (data === null) localStorage.removeItem(LOCAL_KEY(id)); else localStorage.setItem(LOCAL_KEY(id), data); } catch { /* unavailable */ }
}

export interface PlayerProps {
  course: Course;
  /** Preview inside the editor: draws inside its parent, offers Close, never saves progress. */
  embedded?: boolean;
  startAt?: ID | null;
  onClose?: () => void;
  lms?: Lms | null;
}

export function Player({ course, embedded, startAt, onClose, lms }: PlayerProps) {
  const playable = useMemo<Course>(() => (startAt && findSlide(course, startAt) ? { ...course, startSlideId: startAt } : course), [course, startAt]);
  const saved = useMemo(() => {
    if (embedded || !course.player.resume) return null;
    if (lms?.connected) return lms.suspendData || null;
    return readLocal(course.id);
  }, [course, embedded, lms]);
  const [askResume, setAskResume] = useState(() => !!saved && !lms?.connected);
  const [state, setState] = useState<E.PlayerState>(() => (lms?.connected && saved ? E.resumeFrom(playable, saved) : null) ?? E.start(playable));
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [menuOpen, setMenuOpen] = useState(course.player.showMenu && !embedded && typeof window !== 'undefined' && window.innerWidth > 900);
  const [notice, setNotice] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [panel, setPanel] = useState<'resources' | 'glossary' | null>(null);
  const media = useRef(new Map<ID, HTMLMediaElement>());
  const layerShown = useRef<Record<ID, number>>({});
  const clock = useRef({ t: 0, last: 0, entry: -1, ended: false, reached: new Set<number>() });
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const slide = findSlide(course, state.slideId)!;
  const underneath = state.lightboxFrom ? findSlide(course, state.lightboxFrom) ?? null : null;
  const slides = E.playSlides(course, state);
  const inPlay = new Set(slides.map((s) => s.id));
  const index = slides.findIndex((s) => s.id === state.slideId);

  const apply = useCallback((fn: (s: E.PlayerState) => E.PlayerState) => setState((s) => fn(s)), []);

  // ---- effects ----
  useEffect(() => {
    if (state.effects.length === 0) return;
    const [next, fx] = E.takeEffects(state);
    for (const f of fx) {
      switch (f.type) {
        case 'open-url': window.open(f.url, '_blank', 'noopener,noreferrer'); break;
        case 'media': {
          const el = media.current.get(f.objectId);
          if (el) { if (f.op === 'play') void el.play().catch(() => {}); else el.pause(); }
          break;
        }
        case 'timeline': setPaused(f.op === 'pause'); break;
        case 'notice': setNotice(f.message); break;
        case 'completed': lms?.complete(f.status, f.scorePercent); break;
        case 'exit': lms?.finish(); setExited(true); break;
        case 'slide-entered': break;
      }
    }
    setState(next);
  }, [state, lms]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t); }, [notice]);

  // ---- progress ----
  useEffect(() => {
    if (embedded || askResume) return;
    const data = E.suspend(state);
    if (lms?.connected) lms.setProgress(state.slideId, data);
    else if (course.player.resume) writeLocal(course.id, data);
  }, [state.slideId, state.vars, state.answers, embedded, askResume, lms, course, state]);
  useEffect(() => {
    if (!lms?.connected) return;
    const bye = () => lms.finish();
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [lms]);

  // ---- per-question reporting (xAPI) ----
  const lastAnswers = useRef(state.answers);
  useEffect(() => {
    const prev = lastAnswers.current;
    lastAnswers.current = state.answers;
    if (embedded || !lms?.answered) return;
    for (const [id, a] of Object.entries(state.answers)) {
      if (prev[id] === a) continue;
      lms.answered({ id, title: findSlide(course, id)?.title ?? id, correct: a.correct, response: a.response, points: a.points, max: a.max });
    }
  }, [state.answers, lms, embedded, course]);

  // ---- layer timelines: remember when each layer appeared ----
  const layersKey = state.layers.join(',');
  useEffect(() => {
    const shown: Record<ID, number> = {};
    for (const id of state.layers) shown[id] = layerShown.current[id] ?? clock.current.t;
    layerShown.current = shown;
  }, [layersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- clock ----
  useEffect(() => {
    if (clock.current.entry !== state.entry) {
      clock.current = { t: 0, last: performance.now(), entry: state.entry, ended: false, reached: new Set() };
      layerShown.current = {};
      setTime(0);
      for (const el of media.current.values()) el.pause();
    }
  }, [state.entry]);

  useEffect(() => {
    if (askResume || exited) return;
    let raf = 0;
    const marks = [...new Set(slide.triggers.filter((t) => t.event.type === 'timeline-reaches').map((t) => (t.event as { time: number }).time))];
    const tick = (now: number) => {
      const c = clock.current;
      const dt = Math.min(0.25, (now - c.last) / 1000);
      c.last = now;
      if (!paused && !c.ended) {
        c.t = Math.min(slide.duration, c.t + dt);
        for (const m of marks) if (c.t >= m && !c.reached.has(m)) { c.reached.add(m); apply((s) => E.timelineReached(course, s, m)); }
        if (c.t >= slide.duration) { c.ended = true; apply((s) => E.timelineEnded(course, s)); }
        setTime(c.t);
      }
      raf = requestAnimationFrame(tick);
    };
    clock.current.last = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slide, paused, course, apply, askResume, exited]);

  // ---- keyboard triggers ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable=true]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      apply((s) => E.key(course, s, e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [course, apply]);

  // ---- scale to fit ----
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const pad = 16;
      setScale(Math.max(0.1, Math.min((el.clientWidth - pad) / course.size.w, (el.clientHeight - pad) / course.size.h)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [course.size.w, course.size.h, menuOpen]);

  const times: Record<ID, number> = { [slide.layers[0].id]: time };
  for (const id of state.layers) times[id] = time - (layerShown.current[id] ?? time);

  const seek = (t: number) => {
    const c = clock.current;
    c.t = t;
    c.ended = t >= slide.duration;
    c.reached = new Set([...c.reached].filter((m) => m <= t));
    setTime(t);
  };

  const restart = () => {
    writeLocal(course.id, null);
    setState(E.start(playable));
    setExited(false);
  };

  const showTitle = course.player.showTitle;
  const r = E.results(course, state);

  if (exited) {
    return (
      <div className={`player ${embedded ? 'embedded' : ''}`}>
        <div className="row-span-3 grid place-items-center text-center p-8" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
          <div className="box stack" style={{ maxWidth: 420 }}>
            <h1>You have exited the course</h1>
            <p className="muted">You can close this window.</p>
            <div className="row end">
              {embedded && onClose && <Button variant="ghost" onClick={onClose}>Close preview</Button>}
              <Button onClick={restart}><RotateCcw />Start again</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`player ${embedded ? 'embedded' : ''}`} role="application" aria-roledescription="course player" aria-label={course.title}
      style={course.player.accent ? ({ '--accent': course.player.accent, '--focus': course.player.accent } as React.CSSProperties) : undefined}>
      <div className="player-top">
        {course.player.showMenu && (
          <IconButton label={menuOpen ? 'Hide menu' : 'Show menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}><MenuIcon /></IconButton>
        )}
        {showTitle && <h1 className="flex-1 min-w-0 text-[15px] truncate">{course.title}</h1>}
        {!showTitle && <span className="flex-1" />}
        {r.hasQuiz && <span className="badge blue" title="Questions answered">{r.answered}/{slides.filter((s) => s.question?.graded).length} answered</span>}
        {course.player.resources.length > 0 && (
          <Button variant="ghost" size="small" aria-expanded={panel === 'resources'} aria-controls="player-panel" onClick={() => setPanel((p) => (p === 'resources' ? null : 'resources'))}>Resources</Button>
        )}
        {course.player.glossary.length > 0 && (
          <Button variant="ghost" size="small" aria-expanded={panel === 'glossary'} aria-controls="player-panel" onClick={() => setPanel((p) => (p === 'glossary' ? null : 'glossary'))}>Glossary</Button>
        )}
        {embedded && onClose && <Button variant="ghost" onClick={onClose}><X />Close preview</Button>}
      </div>
      <div className="player-body">
        {course.player.showMenu && menuOpen ? (
          <nav className="player-menu" aria-label="Course menu">
            {course.scenes.map((sc) => (
              <div key={sc.id}>
                <div className="snav-group" style={{ marginTop: 10 }}>{sc.name}</div>
                <ul className="snav">
                  {sc.slides.filter((sl) => sl.inMenu && inPlay.has(sl.id)).map((sl) => {
                    const ok = E.canOpenFromMenu(course, state, sl.id);
                    return (
                      <li key={sl.id}>
                        <button type="button" aria-current={sl.id === state.slideId ? 'page' : undefined} disabled={!ok}
                          style={!ok ? { background: 'none' } : undefined}
                          onClick={() => apply((s) => E.navigate(course, s, sl.id))}>
                          <span className="flex-1 truncate">{sl.title}</span>
                          {state.answers[sl.id] && <span className={`badge ${state.answers[sl.id].correct ? 'green' : 'red'}`}>{state.answers[sl.id].correct ? 'Correct' : 'Wrong'}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        ) : <div />}
        <main className="player-stage" ref={stage}>
          <div style={{ width: course.size.w * scale, height: course.size.h * scale, position: 'relative' }}>
            {underneath && (
              <div aria-hidden="true" inert style={{ position: 'absolute', inset: 0 }}>
                <SlideView course={course} slide={underneath} mode="thumb" layerIds={[]} style={{ transform: `scale(${scale})`, position: 'absolute', left: 0, top: 0 }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' }} />
              </div>
            )}
            <div role={underneath ? 'dialog' : undefined} aria-modal={underneath ? true : undefined} aria-label={underneath ? slide.title : undefined}
              style={underneath ? { position: 'absolute', inset: 0, transform: 'scale(.86)', transformOrigin: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.5)', borderRadius: 6, overflow: 'hidden' } : { position: 'absolute', inset: 0 }}>
            <SlideView key={state.entry} course={course} slide={slide} mode="play" layerIds={state.layers} state={state} times={times}
              style={{ transform: `scale(${scale})`, position: 'absolute', left: 0, top: 0 }}
              onClick={(id) => apply((s) => E.click(course, s, id))}
              onHover={(id, entering) => apply((s) => E.hover(course, s, id, entering))}
              onInput={(id, text) => apply((s) => E.input(course, s, id, text))}
              onDrop={(id, target) => apply((s) => E.drop(course, s, id, target))}
              mediaRef={(id, el) => { if (el) media.current.set(id, el); else media.current.delete(id); }} />
            {underneath && (
              <IconButton label="Close lightbox" variant="default" className="absolute top-2 right-2 z-10" onClick={() => apply((s) => E.perform(course, s, { type: 'close-lightbox' }))}><X /></IconButton>
            )}
            </div>
          </div>
          <h2 className="sr-only" aria-live="polite">{slide.title}</h2>
          {notice && <div className="player-notice notice warn" role="alert" style={{ background: 'var(--panel)' }}><b>!</b>{notice}</div>}
          {panel && (
            <aside id="player-panel" className="absolute top-2 right-2 bottom-2 w-[min(340px,90%)] overflow-auto box z-40 shadow-xl" aria-label={panel === 'resources' ? 'Resources' : 'Glossary'}
              style={{ color: 'var(--text)' }} onKeyDown={(e) => { if (e.key === 'Escape') setPanel(null); }}>
              <div className="flex items-center mb-2">
                <h2 className="!m-0 flex-1">{panel === 'resources' ? 'Resources' : 'Glossary'}</h2>
                <IconButton label="Close" autoFocus onClick={() => setPanel(null)}><X /></IconButton>
              </div>
              {panel === 'resources' ? (
                <ul className="grid gap-2">
                  {course.player.resources.map((r, i) => <li key={i}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a></li>)}
                </ul>
              ) : (
                <dl className="grid gap-3">
                  {[...course.player.glossary].sort((a, b) => a.term.localeCompare(b.term)).map((g, i) => (
                    <div key={i}><dt className="font-semibold">{g.term}</dt><dd className="m-0 text-fg-2">{g.definition}</dd></div>
                  ))}
                </dl>
              )}
            </aside>
          )}
        </main>
      </div>
      {course.player.showNav && (
        <div className="player-bar">
          <Button variant="ghost" onClick={() => apply((s) => E.navigate(course, s, 'prev'))} disabled={!E.canGoPrev(course, state)}><ChevronLeft />Prev</Button>
          <IconButton label={paused ? 'Play timeline' : 'Pause timeline'} onClick={() => setPaused((p) => !p)}>{paused ? <Play /> : <Pause />}</IconButton>
          {course.player.showSeekbar ? (
            <input className="seek" type="range" min={0} max={slide.duration} step={0.05} value={time} aria-label="Slide timeline"
              aria-valuetext={`${time.toFixed(1)} of ${slide.duration} seconds`} onChange={(e) => seek(Number(e.target.value))} />
          ) : <span className="flex-1" />}
          <span className="count text-[12px] muted tabular-nums" aria-label={index >= 0 ? `Slide ${index + 1} of ${slides.length}` : 'Extra slide'}>{index >= 0 ? `${index + 1} / ${slides.length}` : '–'}</span>
          <Button onClick={() => apply((s) => E.navigate(course, s, 'next'))} disabled={!E.canGoNext(course, state)}>Next<ChevronRight /></Button>
        </div>
      )}
      {askResume && saved && (
        <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(0,0,0,.55)' }}>
          <div className="box stack" role="dialog" aria-modal="true" aria-labelledby="resume-title" style={{ maxWidth: 420, background: 'var(--panel)', color: 'var(--text)' }}>
            <h1 id="resume-title">Resume where you left off?</h1>
            <p className="muted">You have visited this course before.</p>
            <div className="row end">
              <Button variant="ghost" autoFocus onClick={() => { writeLocal(course.id, null); setAskResume(false); }}>Start over</Button>
              <Button onClick={() => { const s = E.resumeFrom(playable, saved); if (s) setState(s); setAskResume(false); }}>Resume</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
