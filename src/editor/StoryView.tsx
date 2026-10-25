// Story view: every scene and slide at a glance, with where each slide's triggers can take the learner.
import { allSlides, slideLinks } from '../model/query.ts';
import { SlideThumb } from '../render/SlideView.tsx';
import { ArrowRight } from '../ui/icons.tsx';
import { useEditor } from './context.tsx';

export function StoryView({ onOpen }: { onOpen: () => void }) {
  const { course, state, select } = useEditor();
  const flat = allSlides(course);
  const title = (id: string) => {
    const i = flat.findIndex((s) => s.id === id);
    return i >= 0 ? `${i + 1}. ${flat[i].title}` : 'missing';
  };
  return (
    <div className="story" aria-label="Story view">
      <p className="muted mb-4 text-[13px]">Click a slide to select it, double-click to edit it. Arrows list the slides each slide's triggers can jump to.</p>
      {course.scenes.map((sc) => (
        <section key={sc.id} className="story-scene" aria-label={sc.name}>
          <h2 className="!mt-0">{sc.name}</h2>
          <div className="story-grid">
            {sc.slides.map((sl) => {
              const links = slideLinks(course, sl);
              return (
                <button key={sl.id} type="button" className="story-card" aria-current={sl.id === state.sel.slideId}
                  onClick={() => select({ slideId: sl.id, objectIds: [] })}
                  onDoubleClick={() => { select({ slideId: sl.id, objectIds: [] }); onOpen(); }}>
                  <SlideThumb course={course} slide={sl} width={162} />
                  <div className="text-[12px] font-semibold mt-1 truncate">{flat.indexOf(sl) + 1}. {sl.title}</div>
                  <ul className="text-[11px] text-fg-2 mt-1 grid gap-0.5">
                    {links.slice(0, 5).map((l, i) => (
                      <li key={i} className="flex items-center gap-1 truncate"><ArrowRight size={11} className="shrink-0" /><span className="truncate">{title(l.to)}</span><span className="muted truncate">({l.label})</span></li>
                    ))}
                    {links.length > 5 && <li className="muted">+{links.length - 5} more</li>}
                    {sl.layers.length > 1 && <li className="muted">{sl.layers.length - 1} layer(s)</li>}
                  </ul>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
