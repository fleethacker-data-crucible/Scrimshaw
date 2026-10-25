// Printable storyboard: every slide pictured, with its layers, objects, triggers, question setup
// and notes. One self-contained HTML file for review and sign-off (print it or save it as PDF).
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { describeTrigger } from '../model/describe.ts';
import { allSlides, slideTriggers } from '../model/query.ts';
import type { Course, Slide } from '../model/types.ts';
import { SlideView } from '../render/SlideView.tsx';

const KIND: Record<string, string> = {
  'multiple-choice': 'Multiple choice', 'multiple-response': 'Multiple response', 'true-false': 'True / false',
  'fill-in': 'Fill in the blank', 'drag-drop': 'Drag and drop', hotspot: 'Hotspot', numeric: 'Numeric', essay: 'Essay',
};

function SlidePage({ course, slide, n }: { course: Course; slide: Slide; n: number }) {
  const w = 520;
  const scale = w / course.size.w;
  const q = slide.question;
  const triggers = slideTriggers(slide);
  return (
    <section className="sb-slide">
      <h2>{n}. {slide.title}</h2>
      <div className="sb-row">
        <div className="sb-shot" style={{ width: w, height: course.size.h * scale }}>
          <SlideView course={course} slide={slide} mode="thumb" layerIds={[]} style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }} />
        </div>
        <div className="sb-meta">
          <p><b>Timeline:</b> {slide.duration}s, {slide.advance === 'auto' ? 'advances automatically' : 'learner advances'}</p>
          {slide.layers.length > 1 && <p><b>Layers:</b> {slide.layers.slice(1).map((l) => l.name).join(', ')}</p>}
          {q && (
            <div>
              <p><b>Question:</b> {KIND[q.kind]}{q.graded ? `, ${q.points} points` : ', not scored'}, {q.attempts === 0 ? 'unlimited attempts' : `${q.attempts} attempt${q.attempts > 1 ? 's' : ''}`}</p>
              {q.kind === 'fill-in' && <p><b>Accepted:</b> {q.accepted.filter(Boolean).join(' · ')}</p>}
              {q.kind === 'numeric' && <p><b>Accepted:</b> {q.numMin === q.numMax ? q.numMin : `${q.numMin} to ${q.numMax}`}</p>}
              {['multiple-choice', 'multiple-response', 'true-false'].includes(q.kind) && (
                <ul>{slide.layers.flatMap((l) => l.objects).filter((o) => o.kind === 'choice').map((o) => <li key={o.id}>{o.correct ? '✔ ' : '✗ '}{o.text}</li>)}</ul>
              )}
              {q.kind === 'drag-drop' && (
                <ul>{slide.layers.flatMap((l) => l.objects).filter((o) => o.draggable).map((o) => {
                  const t = slide.layers.flatMap((l) => l.objects).find((x) => x.id === o.correctTargetId);
                  return <li key={o.id}>{o.text || o.name} → {t ? (t.text || t.name) : 'anywhere'}</li>;
                })}</ul>
              )}
              {q.kind === 'hotspot' && <p><b>Correct areas:</b> {slide.layers.flatMap((l) => l.objects).filter((o) => o.kind === 'hotspot' && o.correct).map((o) => o.name).join(', ')}</p>}
            </div>
          )}
          {slide.notes && <p className="sb-notes"><b>Notes:</b> {slide.notes}</p>}
        </div>
      </div>
      {triggers.length > 0 && (
        <table className="sb-table">
          <caption>Triggers</caption>
          <thead><tr><th scope="col">Action</th><th scope="col">When</th><th scope="col">Conditions</th><th scope="col">On</th></tr></thead>
          <tbody>
            {triggers.map(({ trigger, layer, object }) => {
              const d = describeTrigger(course, slide, trigger, object);
              return <tr key={trigger.id}><td>{d.action}</td><td>{d.when}</td><td>{d.conditions || '–'}</td><td>{object ? object.name : layer ? `Layer ${layer.name}` : 'Slide'}</td></tr>;
            })}
          </tbody>
        </table>
      )}
      {slide.layers.slice(1).map((l) => (
        <div key={l.id} className="sb-layer">
          <h3>Layer: {l.name}</h3>
          <div className="sb-shot" style={{ width: w * 0.6, height: course.size.h * scale * 0.6 }}>
            <SlideView course={course} slide={slide} mode="thumb" layerIds={[l.id]} style={{ transform: `scale(${scale * 0.6})`, transformOrigin: '0 0' }} />
          </div>
        </div>
      ))}
    </section>
  );
}

const PRINT_CSS = `
  body { background: #fff; color: #1a1a19; margin: 0; padding: 24px; font: 14px/1.5 var(--sans); overflow: auto; height: auto; }
  .sb-head { border-bottom: 2px solid #1a1a19; margin-bottom: 20px; padding-bottom: 8px; }
  .sb-head h1 { font-size: 26px; margin: 0; }
  .sb-slide { break-inside: avoid; page-break-inside: avoid; border-bottom: 1px solid #dddcd6; padding: 16px 0 20px; }
  .sb-slide h2 { font-size: 17px; text-transform: none; letter-spacing: 0; color: #1a1a19; margin: 0 0 10px; }
  .sb-slide h3 { font-size: 13px; margin: 10px 0 6px; }
  .sb-row { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
  .sb-shot { position: relative; overflow: hidden; border: 1px solid #9a988f; flex: none; }
  .sb-meta { flex: 1; min-width: 220px; }
  .sb-meta p { margin: 0 0 6px; }
  .sb-meta ul { margin: 0 0 6px; padding-left: 18px; }
  .sb-notes { background: #f4f4f2; padding: 6px 8px; border-left: 3px solid #e8c15a; white-space: pre-wrap; }
  .sb-table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 12.5px; }
  .sb-table caption { text-align: left; font-weight: 600; padding: 4px 0; }
  .sb-table th, .sb-table td { border: 1px solid #dddcd6; padding: 4px 8px; text-align: left; vertical-align: top; }
  .sb-table th { background: #f4f4f2; }
  @media print { body { padding: 0; } .sb-slide { padding: 10px 0; } }
`;

/** css: the app's own stylesheet text, so slides render exactly as in the editor. */
/** Renders React into a detached element and returns its HTML (no server renderer in the bundle). */
function toMarkup(node: ReactNode): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(node));
  const html = host.innerHTML;
  root.unmount();
  return html;
}

export function buildStoryboard(course: Course, css: string): string {
  const slides = allSlides(course);
  const body = toMarkup(
    <main>
      <header className="sb-head">
        <h1>{course.title}</h1>
        <p>Storyboard · {slides.length} slides · {course.scenes.length} scene{course.scenes.length === 1 ? '' : 's'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date())}{course.author ? ` · ${course.author}` : ''}</p>
        {course.variables.length > 0 && <p><b>Variables:</b> {course.variables.map((v) => `${v.name} (${v.type}, starts ${JSON.stringify(v.initial)})`).join(', ')}</p>}
      </header>
      {course.scenes.map((sc) => (
        <div key={sc.id}>
          <h2 style={{ fontSize: 13, marginTop: 24 }}>{sc.name}{sc.bank ? ` (question bank${sc.bank.draw ? `, draws ${sc.bank.draw}` : ''}${sc.bank.shuffle ? ', shuffled' : ''})` : ''}</h2>
          {sc.slides.map((sl) => <SlidePage key={sl.id} course={course} slide={sl} n={slides.indexOf(sl) + 1} />)}
        </div>
      ))}
    </main>,
  );
  const title = course.title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  return `<!doctype html>
<html lang="en" data-theme="light" class="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: storyboard</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
<style>${PRINT_CSS}</style>
</head>
<body>${body}</body>
</html>
`;
}

/** The app's CSS as currently loaded (the build inlines it into one <style> element). */
export function currentCss(doc: Document): string {
  return [...doc.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
}
