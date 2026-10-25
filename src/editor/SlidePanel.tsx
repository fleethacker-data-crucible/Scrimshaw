import { useState } from 'react';
import { newLikertSlide, newQuestionSlide, newResultsSlide, newSequenceSlide, newSlide, newWordBankSlide } from '../model/factory.ts';
import { allSlides, findSlide, sceneOfSlide } from '../model/query.ts';
import type { ID, QuestionKind, Slide } from '../model/types.ts';
import { SlideThumb } from '../render/SlideView.tsx';
import { addScene, copySlide, deleteScene, deleteSlide, insertSlideAfter, moveSlide } from '../store/ops.ts';
import { CircleCheck, Copy, Ellipsis, Flag, ListChecks, Plus, Trash, Trophy } from '../ui/icons.tsx';
import { Button, Dialog, Field, Menu, NumberInput, useUi, type MenuItem } from '../ui/kit.tsx';
import { useEditor } from './context.tsx';

export const QUESTION_KINDS: { kind: QuestionKind; label: string }[] = [
  { kind: 'multiple-choice', label: 'Multiple choice' },
  { kind: 'multiple-response', label: 'Multiple response' },
  { kind: 'true-false', label: 'True / false' },
  { kind: 'fill-in', label: 'Fill in the blank' },
  { kind: 'drag-drop', label: 'Drag and drop' },
  { kind: 'hotspot', label: 'Hotspot' },
  { kind: 'numeric', label: 'Numeric' },
  { kind: 'essay', label: 'Essay (survey)' },
];

/** Items for "new slide" menus, shared with the ribbon. */
export function useNewSlideItems(afterId: () => ID | null): MenuItem[] {
  const { edit } = useEditor();
  const add = (label: string, make: () => Slide) => edit(label, (c) => {
    const s = insertSlideAfter(c, afterId(), make());
    return { slideId: s.id, layerId: s.layers[0].id, objectIds: [] };
  });
  return [
    { label: 'Blank slide', icon: <Plus />, onSelect: () => add('New slide', () => newSlide()) },
    { separator: true, label: '' },
    ...QUESTION_KINDS.map((q) => ({ label: `${q.label} question`, icon: <ListChecks />, onSelect: () => add(`New ${q.label} question`, () => newQuestionSlide(q.kind)) })),
    { label: 'Word bank (fill the blanks)', icon: <ListChecks />, onSelect: () => add('New word bank question', () => newWordBankSlide()) },
    { label: 'Sequence (put in order)', icon: <ListChecks />, onSelect: () => add('New sequence question', () => newSequenceSlide()) },
    { label: 'Likert scale (survey)', icon: <ListChecks />, onSelect: () => add('New Likert scale', () => newLikertSlide()) },
    { label: 'Results slide', icon: <Trophy />, onSelect: () => add('New results slide', () => newResultsSlide()) },
  ];
}

export function SlidePanel() {
  const { course, state, select, edit } = useEditor();
  const { confirm, prompt } = useUi();
  const [dragId, setDragId] = useState<ID | null>(null);
  const [dropAt, setDropAt] = useState<{ sceneId: ID; index: number } | null>(null);
  const [bankFor, setBankFor] = useState<ID | null>(null);
  const current = state.sel.slideId;
  const newItems = useNewSlideItems(() => current);
  const flat = allSlides(course);
  const startId = course.startSlideId ?? flat[0]?.id;

  const slideMenu = (sl: Slide): MenuItem[] => {
    const scene = sceneOfSlide(course, sl.id)!;
    const i = scene.slides.indexOf(sl);
    return [
      { label: 'Duplicate', icon: <Copy />, shortcut: 'Ctrl+Shift+D', onSelect: () => edit('Duplicate slide', (c) => {
        const orig = findSlide(c, sl.id)!;
        const s = insertSlideAfter(c, sl.id, copySlide(orig));
        return { slideId: s.id, layerId: s.layers[0].id, objectIds: [] };
      }) },
      { label: 'Move up', disabled: i === 0, onSelect: () => edit('Move slide', (c) => moveSlide(c, sl.id, scene.id, i - 1)) },
      { label: 'Move down', disabled: i === scene.slides.length - 1, onSelect: () => edit('Move slide', (c) => moveSlide(c, sl.id, scene.id, i + 1)) },
      ...course.scenes.filter((s) => s.id !== scene.id).map((s) => ({ label: `Move to ${s.name}`, onSelect: () => edit('Move slide', (c) => moveSlide(c, sl.id, s.id, 999)) })),
      { separator: true, label: '' },
      { label: 'Start course here', icon: <Flag />, disabled: sl.id === startId, onSelect: () => edit('Set start slide', (c) => { c.startSlideId = sl.id; }) },
      { label: 'Completes the course', icon: <CircleCheck />, disabled: course.quiz.completionSlideId === sl.id, onSelect: () => edit('Set completion slide', (c) => { c.quiz.completionSlideId = sl.id; }) },
      { separator: true, label: '' },
      { label: 'Delete slide', icon: <Trash />, danger: true, disabled: flat.length <= 1, onSelect: async () => {
        if (!(await confirm({ title: 'Delete slide?', message: `“${sl.title}” and its layers and triggers will be deleted. Triggers on other slides that jump to it are removed. You can undo this.`, ok: 'Delete', danger: true }))) return;
        edit('Delete slide', (c) => { const next = deleteSlide(c, sl.id); return next ? { slideId: next, objectIds: [] } : undefined; });
      } },
    ];
  };

  return (
    <nav className="pane left" aria-label="Scenes and slides">
      <div className="pane-head">
        <h2>Slides</h2>
        <Menu label="New slide" items={newItems} size="small" variant="default" title="New slide (Ctrl+M)"><Plus size={14} />Slide</Menu>
      </div>
      <div className="px-2 pt-2">
        <button type="button" className={`thumb w-full !h-auto !p-1.5 !bg-transparent !text-fg !font-normal text-left !grid`} aria-current={current === course.master.id}
          onClick={() => select({ slideId: course.master.id, layerId: course.master.layers[0].id, objectIds: [] })}
          aria-label={`Slide master: objects shown on every slide (${course.master.layers[0].objects.length})`}>
          <span className="num">M</span>
          <span className="min-w-0 block">
            <span className="mini block"><SlideThumb course={course} slide={course.master} width={176} /></span>
            <span className="t block">Slide master</span>
          </span>
        </button>
      </div>
      {course.scenes.map((scene) => (
        <section key={scene.id} aria-label={scene.name}
          onDragOver={(e) => { if (dragId) { e.preventDefault(); if (scene.slides.length === 0) setDropAt({ sceneId: scene.id, index: 0 }); } }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dropAt) edit('Move slide', (c) => moveSlide(c, dragId, dropAt.sceneId, dropAt.index));
            setDragId(null); setDropAt(null);
          }}>
          <div className="scene-head">
            <span className="name">{scene.name}</span>
            {scene.bank && <span className="badge purple" title={`Question bank: ${scene.bank.shuffle ? 'shuffled' : 'in order'}${scene.bank.draw ? `, draws ${scene.bank.draw}` : ''}`}>Bank</span>}
            <Menu label={`Scene ${scene.name} options`} size="icon" align="right" items={[
              { label: 'Rename scene…', icon: <Ellipsis />, onSelect: async () => {
                const name = await prompt({ title: 'Rename scene', label: 'Scene name', value: scene.name, ok: 'Rename' });
                if (name) edit('Rename scene', (c) => { c.scenes.find((s) => s.id === scene.id)!.name = name; });
              } },
              { label: 'Add slide to scene', icon: <Plus />, onSelect: () => edit('New slide', (c) => {
                const s = newSlide();
                c.scenes.find((x) => x.id === scene.id)!.slides.push(s);
                return { slideId: s.id, layerId: s.layers[0].id, objectIds: [] };
              }) },
              { label: 'New scene', icon: <Plus />, onSelect: () => edit('New scene', (c) => { const sc = addScene(c); return { slideId: sc.slides[0].id, objectIds: [] }; }) },
              { label: 'Question bank…', icon: <ListChecks />, onSelect: () => setBankFor(scene.id) },
              { separator: true, label: '' },
              { label: 'Delete scene', icon: <Trash />, danger: true, disabled: course.scenes.length <= 1, onSelect: async () => {
                if (!(await confirm({ title: 'Delete scene?', message: `“${scene.name}” and its ${scene.slides.length} slide(s) will be deleted. You can undo this.`, ok: 'Delete', danger: true }))) return;
                edit('Delete scene', (c) => { deleteScene(c, scene.id); });
              } },
            ]}><Ellipsis /></Menu>
          </div>
          <ol className="slide-list">
            {scene.slides.map((sl, i) => (
              <li key={sl.id} className={`thumb ${dropAt?.sceneId === scene.id && dropAt.index === i && dragId !== sl.id ? 'drop-before' : ''}`}
                aria-current={sl.id === current}
                draggable onDragStart={(e) => { setDragId(sl.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sl.id); }}
                onDragEnd={() => { setDragId(null); setDropAt(null); }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setDropAt({ sceneId: scene.id, index: e.clientY > r.top + r.height / 2 ? i + 1 : i });
                }}
                onClick={() => select({ slideId: sl.id, layerId: sl.layers[0].id, objectIds: [] })}>
                <span className="num">{flat.indexOf(sl) + 1}</span>
                <div className="min-w-0">
                  <button type="button" className="mini block p-0 h-auto w-full" style={{ background: 'none' }}
                    aria-label={`Slide ${flat.indexOf(sl) + 1}: ${sl.title}${sl.question ? ' (question)' : ''}`}
                    aria-current={sl.id === current ? 'true' : undefined}>
                    <SlideThumb course={course} slide={sl} width={176} />
                  </button>
                  <div className="flex items-center gap-1">
                    <div className="t flex-1" title={sl.title}>{sl.title}</div>
                    {sl.id === startId && <span className="badge gold" title="Course starts here">Start</span>}
                    {sl.question && <span className="badge blue" title="Question slide">Q</span>}
                    <Menu label={`Slide ${sl.title} options`} size="icon" align="right" items={slideMenu(sl)}><Ellipsis size={14} /></Menu>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {bankFor && <BankDialog sceneId={bankFor} onClose={() => setBankFor(null)} />}
      <div className="p-2">
        <Button variant="ghost" className="w-full justify-center" onClick={() => edit('New scene', (c) => { const sc = addScene(c); return { slideId: sc.slides[0].id, objectIds: [] }; })}>
          <Plus />New scene
        </Button>
      </div>
    </nav>
  );
}

function BankDialog({ sceneId, onClose }: { sceneId: ID; onClose: () => void }) {
  const { course, edit } = useEditor();
  const scene = course.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  const questions = scene.slides.filter((s) => s.question).length;
  const bank = scene.bank ?? { shuffle: false, draw: 0 };
  const set = (b: { shuffle: boolean; draw: number } | null) => edit('Question bank', (c) => { c.scenes.find((s) => s.id === sceneId)!.bank = b; }, 'bank');
  return (
    <Dialog title={`Question bank: ${scene.name}`} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <p className="muted text-[13px]">Each attempt can show this scene's {questions} question slide(s) in a random order, or a random selection of them. Other slides in the scene stay where they are. Retrying the quiz draws again.</p>
      <label className="check"><input type="checkbox" checked={!!scene.bank} onChange={(e) => set(e.target.checked ? bank : null)} /> Use this scene as a question bank</label>
      {scene.bank && (
        <>
          <label className="check"><input type="checkbox" checked={bank.shuffle} onChange={(e) => set({ ...bank, shuffle: e.target.checked })} /> Shuffle the order</label>
          <Field label="Questions to draw" hint={`0 draws all ${questions}.`}>
            <NumberInput label="Questions to draw" min={0} max={questions} value={bank.draw} onChange={(v) => set({ ...bank, draw: Math.round(v) })} className="w-24" />
          </Field>
          <p className="hint">Scores count only the questions a learner was given.</p>
        </>
      )}
    </Dialog>
  );
}
