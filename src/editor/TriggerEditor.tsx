// Trigger wizard: action, its target, the event that fires it, and optional conditions.
import { useMemo, useState } from 'react';
import { newTrigger } from '../model/factory.ts';
import { ACTION_LABELS, EVENT_LABELS, OP_LABELS, VAR_OP_LABELS } from '../model/describe.ts';
import { allSlides, findObject, slideObjects } from '../model/query.ts';
import { BUILTIN_STATES, BUILTIN_VARIABLES, type Action, type Condition, type ConditionOp, type Course, type ID, type Slide, type SlideObject, type Trigger, type TriggerEvent, type Value, type VariableOp } from '../model/types.ts';
import { Plus, Trash } from '../ui/icons.tsx';
import { Button, Dialog, Field, IconButton } from '../ui/kit.tsx';

export type TriggerOwner = { kind: 'slide' } | { kind: 'layer'; layerId: ID } | { kind: 'object'; objectId: ID };

const ACTION_GROUPS: { label: string; types: Action['type'][] }[] = [
  { label: 'Common', types: ['set-state', 'show-layer', 'hide-layer', 'next-slide', 'prev-slide', 'jump-slide', 'adjust-variable'] },
  { label: 'Navigation', types: ['jump-scene', 'restart-course', 'exit-course'] },
  { label: 'Media and timeline', types: ['play-media', 'pause-media', 'pause-timeline', 'resume-timeline'] },
  { label: 'Quiz', types: ['submit-interaction', 'reset-results'] },
  { label: 'More', types: ['open-url'] },
];

function defaultAction(type: Action['type'], course: Course, slide: Slide, owner: SlideObject | null): Action {
  const layers = slide.layers.filter((l) => !l.base);
  const objs = slideObjects(slide);
  switch (type) {
    case 'jump-slide': return { type, slideId: allSlides(course)[0].id };
    case 'jump-scene': return { type, sceneId: course.scenes[0].id };
    case 'show-layer': return { type, layerId: layers[0]?.id ?? '' };
    case 'hide-layer': return { type, layerId: 'this' };
    case 'set-state': return { type, objectId: owner ? 'this' : (objs[0]?.id ?? ''), state: 'Normal' };
    case 'adjust-variable': return { type, variableId: course.variables[0]?.id ?? '', op: 'set', value: '' };
    case 'open-url': return { type, url: 'https://' };
    case 'play-media': case 'pause-media': return { type, objectId: objs.find((o) => o.kind === 'video' || o.kind === 'audio')?.id ?? '' };
    default: return { type } as Action;
  }
}

function eventChoices(owner: TriggerOwner): TriggerEvent['type'][] {
  return owner.kind === 'object'
    ? ['click', 'hover-enter', 'hover-leave', 'drop', 'variable-change', 'state-change']
    : ['timeline-start', 'timeline-end', 'timeline-reaches', 'variable-change', 'key', 'state-change'];
}

function defaultEvent(type: TriggerEvent['type'], course: Course, slide: Slide): TriggerEvent {
  switch (type) {
    case 'variable-change': return { type, variableId: course.variables[0]?.id ?? '' };
    case 'key': return { type, key: 'Enter' };
    case 'timeline-reaches': return { type, time: 1 };
    case 'drop': return { type, targetId: 'any' };
    case 'state-change': return { type, objectId: slideObjects(slide)[0]?.id ?? '', state: 'Selected' };
    default: return { type } as TriggerEvent;
  }
}

export function statesFor(o: SlideObject | undefined): string[] {
  const names = new Set<string>(['Normal', 'Hidden', 'Disabled', ...(o?.kind === 'choice' ? ['Selected'] : []), ...(o?.states.map((s) => s.name) ?? [])]);
  return [...names];
}

export function TriggerEditor({ course, slide, owner, trigger, onSave, onClose }: {
  course: Course; slide: Slide; owner: TriggerOwner; trigger: Trigger | null;
  onSave: (t: Trigger) => void; onClose: () => void;
}) {
  const self = owner.kind === 'object' ? findObject(slide, owner.objectId) ?? null : null;
  const [t, setT] = useState<Trigger>(() => trigger ? structuredClone(trigger) : newTrigger(
    owner.kind === 'object' ? { type: 'click' } : { type: 'timeline-start' },
    owner.kind === 'object' && slide.layers.length > 1 ? { type: 'show-layer', layerId: slide.layers[1].id } : defaultAction('next-slide', course, slide, self),
  ));
  const objs = slideObjects(slide);
  const slides = allSlides(course);
  const layers = slide.layers.filter((l) => !l.base);
  const setAction = (a: Action) => setT({ ...t, action: a });
  const setEvent = (e: TriggerEvent) => setT({ ...t, event: e });
  const a = t.action;
  const e = t.event;

  const problems = useMemo(() => {
    const p: string[] = [];
    if ((a.type === 'show-layer' || (a.type === 'hide-layer' && a.layerId !== 'this')) && !layers.some((l) => l.id === a.layerId)) p.push('Choose a layer. Add one in the Layers panel first.');
    if (a.type === 'adjust-variable' && !course.variables.some((v) => v.id === a.variableId)) p.push('Choose a variable. Create one with Variables in the ribbon.');
    if ((a.type === 'set-state' || a.type === 'play-media' || a.type === 'pause-media') && a.objectId !== 'this' && !objs.some((o) => o.id === a.objectId)) p.push('Choose an object.');
    if (a.type === 'open-url' && !/^(https?:|mailto:)/i.test(a.url.trim())) p.push('The URL must start with https://, http:// or mailto:.');
    if (e.type === 'variable-change' && !course.variables.some((v) => v.id === e.variableId)) p.push('Choose the variable to watch.');
    if (e.type === 'key' && !e.key.trim()) p.push('Enter a key, for example Enter or ArrowRight.');
    return p;
  }, [a, e, layers, objs, course.variables]);

  const varOptions = course.variables.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.type})</option>);
  const objectSelect = (value: ID | 'this', onChange: (id: ID) => void, filter?: (o: SlideObject) => boolean, allowThis = true) => (
    <select value={value} onChange={(ev) => onChange(ev.target.value)} aria-label="Object">
      {allowThis && self && <option value="this">This object ({self.name})</option>}
      {slide.layers.map((l) => (
        <optgroup key={l.id} label={l.name}>
          {l.objects.filter(filter ?? (() => true)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </optgroup>
      ))}
    </select>
  );

  const setCond = (i: number, c: Condition) => setT({ ...t, conditions: t.conditions.map((x, j) => (j === i ? c : x)) });

  return (
    <Dialog title={trigger ? 'Edit trigger' : 'New trigger'} onClose={onClose} wide={620} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(t)} disabled={problems.length > 0}>{trigger ? 'Save trigger' : 'Add trigger'}</Button>
      </>
    }>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Action">
          <select value={a.type} onChange={(ev) => setAction(defaultAction(ev.target.value as Action['type'], course, slide, self))}>
            {ACTION_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map((ty) => <option key={ty} value={ty}>{ACTION_LABELS[ty]}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="grid gap-1">
          {a.type === 'jump-slide' && (
            <Field label="Slide">
              <select value={a.slideId} onChange={(ev) => setAction({ ...a, slideId: ev.target.value })}>
                {course.scenes.map((sc) => <optgroup key={sc.id} label={sc.name}>{sc.slides.map((s) => <option key={s.id} value={s.id}>{slides.indexOf(s) + 1}. {s.title}</option>)}</optgroup>)}
              </select>
            </Field>
          )}
          {a.type === 'jump-scene' && (
            <Field label="Scene">
              <select value={a.sceneId} onChange={(ev) => setAction({ ...a, sceneId: ev.target.value })}>
                {course.scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
              </select>
            </Field>
          )}
          {(a.type === 'show-layer' || a.type === 'hide-layer') && (
            <Field label="Layer">
              <select value={a.layerId} onChange={(ev) => setAction({ ...a, layerId: ev.target.value })}>
                {a.type === 'hide-layer' && <option value="this">This layer</option>}
                {layers.length === 0 && a.type === 'show-layer' && <option value="">No layers yet</option>}
                {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          )}
          {a.type === 'set-state' && (
            <>
              <Field label="Object">{objectSelect(a.objectId, (id) => setAction({ ...a, objectId: id }))}</Field>
              <Field label="State">
                <select value={a.state} onChange={(ev) => setAction({ ...a, state: ev.target.value })}>
                  {statesFor(a.objectId === 'this' ? self ?? undefined : findObject(slide, a.objectId)).map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </>
          )}
          {(a.type === 'play-media' || a.type === 'pause-media') && (
            <Field label="Media">{objectSelect(a.objectId, (id) => setAction({ ...a, objectId: id }), (o) => o.kind === 'video' || o.kind === 'audio', false)}</Field>
          )}
          {a.type === 'open-url' && (
            <Field label="URL" hint="Opens in a new window.">
              <input value={a.url} onChange={(ev) => setAction({ ...a, url: ev.target.value })} inputMode="url" />
            </Field>
          )}
          {a.type === 'adjust-variable' && <VariableAction course={course} a={a} onChange={setAction} varOptions={varOptions} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="When">
          <select value={e.type} onChange={(ev) => setEvent(defaultEvent(ev.target.value as TriggerEvent['type'], course, slide))}>
            {eventChoices(owner).map((ty) => <option key={ty} value={ty}>{EVENT_LABELS[ty]}</option>)}
          </select>
        </Field>
        <div className="grid gap-1">
          {e.type === 'variable-change' && (
            <Field label="Variable"><select value={e.variableId} onChange={(ev) => setEvent({ ...e, variableId: ev.target.value })}>{varOptions}</select></Field>
          )}
          {e.type === 'key' && <Field label="Key" hint="A key name such as Enter, Escape, ArrowRight or a letter."><input value={e.key} onChange={(ev) => setEvent({ ...e, key: ev.target.value })} /></Field>}
          {e.type === 'timeline-reaches' && <Field label="Time (seconds)"><input type="number" min={0} step={0.1} value={e.time} onChange={(ev) => setEvent({ ...e, time: Math.max(0, Number(ev.target.value) || 0) })} /></Field>}
          {e.type === 'state-change' && (
            <>
              <Field label="Object">{objectSelect(e.objectId, (id) => setEvent({ ...e, objectId: id }), undefined, false)}</Field>
              <Field label="Changes to">
                <select value={e.state} onChange={(ev) => setEvent({ ...e, state: ev.target.value })}>
                  {statesFor(findObject(slide, e.objectId)).map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </>
          )}
          {(e.type === 'click' || e.type === 'hover-enter' || e.type === 'hover-leave') && <p className="muted text-[12px] mt-6">Object: {self?.name}</p>}
          {e.type === 'drop' && (
            <Field label="Drop target" hint={self?.draggable ? undefined : 'Turn on “Learner can drag this” in the Design tab.'}>
              <select value={e.targetId} onChange={(ev) => setEvent({ ...e, targetId: ev.target.value })}>
                <option value="any">Any drop target</option>
                {objs.filter((o) => o.dropTarget).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      </div>

      <fieldset>
        <legend>Conditions</legend>
        {t.conditions.length === 0 && <p className="muted text-[13px]">Runs every time. Add a condition to run it only when something is true.</p>}
        <div className="grid gap-2">
          {t.conditions.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1">
              {i > 0 && (
                <select aria-label="Combine conditions with" value={t.join} onChange={(ev) => setT({ ...t, join: ev.target.value as 'and' | 'or' })}>
                  <option value="and">and</option><option value="or">or</option>
                </select>
              )}
              {c.kind === 'variable' ? (
                <>
                  <select aria-label="Variable" value={c.variableId} onChange={(ev) => setCond(i, { ...c, variableId: ev.target.value })}>
                    {varOptions}
                    <optgroup label="Built-in">{BUILTIN_VARIABLES.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup>
                  </select>
                  <select aria-label="Comparison" value={c.op} onChange={(ev) => setCond(i, { ...c, op: ev.target.value as ConditionOp })}>
                    {(Object.keys(OP_LABELS) as ConditionOp[]).map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
                  </select>
                  {c.op !== 'empty' && c.op !== 'not-empty' && (
                    <input aria-label="Value" className="w-28" value={String(c.value)} onChange={(ev) => setCond(i, { ...c, value: coerce(course, c.variableId, ev.target.value) })} />
                  )}
                </>
              ) : (
                <>
                  {objectSelect(c.objectId, (id) => setCond(i, { ...c, objectId: id }), undefined, true)}
                  <select aria-label="Is or is not" value={c.is ? 'is' : 'not'} onChange={(ev) => setCond(i, { ...c, is: ev.target.value === 'is' })}>
                    <option value="is">is</option><option value="not">is not</option>
                  </select>
                  <select aria-label="State" value={c.state} onChange={(ev) => setCond(i, { ...c, state: ev.target.value })}>
                    {[...new Set([...BUILTIN_STATES, ...statesFor(c.objectId === 'this' ? self ?? undefined : findObject(slide, c.objectId))])].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </>
              )}
              <IconButton label="Remove condition" onClick={() => setT({ ...t, conditions: t.conditions.filter((_, j) => j !== i) })}><Trash /></IconButton>
            </div>
          ))}
        </div>
        <div className="row mt-2">
          <Button size="small" variant="ghost" disabled={course.variables.length === 0 && false}
            onClick={() => setT({ ...t, conditions: [...t.conditions, { kind: 'variable', variableId: course.variables[0]?.id ?? 'Results.Passed', op: '==', value: course.variables[0]?.initial ?? true }] })}>
            <Plus size={14} />Variable condition
          </Button>
          <Button size="small" variant="ghost" disabled={objs.length === 0}
            onClick={() => setT({ ...t, conditions: [...t.conditions, { kind: 'state', objectId: self ? 'this' : objs[0].id, is: true, state: 'Visited' }] })}>
            <Plus size={14} />State condition
          </Button>
        </div>
      </fieldset>
      <label className="check"><input type="checkbox" checked={t.enabled} onChange={(ev) => setT({ ...t, enabled: ev.target.checked })} /> Enabled</label>
      {problems.map((p) => <p key={p} className="error" role="alert">{p}</p>)}
    </Dialog>
  );
}

function coerce(course: Course, variableId: ID, text: string): Value {
  const v = course.variables.find((x) => x.id === variableId);
  const type = v?.type ?? (variableId === 'Results.Passed' ? 'boolean' : variableId.startsWith('Results.') || variableId.startsWith('Project.Slide') || variableId === 'Project.TotalSlides' ? 'number' : 'text');
  if (type === 'number') return text.trim() === '' || Number.isNaN(Number(text)) ? text : Number(text);
  if (type === 'boolean') return text.trim().toLowerCase() === 'true' ? true : text.trim().toLowerCase() === 'false' ? false : text;
  return text;
}

function VariableAction({ course, a, onChange, varOptions }: {
  course: Course; a: Extract<Action, { type: 'adjust-variable' }>; onChange: (a: Action) => void; varOptions: React.ReactNode;
}) {
  const v = course.variables.find((x) => x.id === a.variableId);
  const ops: VariableOp[] = v?.type === 'number' ? ['set', 'add', 'subtract', 'multiply', 'divide'] : v?.type === 'boolean' ? ['set', 'toggle'] : ['set', 'add'];
  const useVar = !!a.fromVariableId;
  return (
    <>
      <Field label="Variable">
        <select value={a.variableId} onChange={(ev) => onChange({ ...a, variableId: ev.target.value, op: 'set', value: course.variables.find((x) => x.id === ev.target.value)?.initial ?? '' })}>
          {course.variables.length === 0 && <option value="">No variables yet</option>}
          {varOptions}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-1">
        <Field label="Operator">
          <select value={a.op} onChange={(ev) => onChange({ ...a, op: ev.target.value as VariableOp })}>
            {ops.map((op) => <option key={op} value={op}>{op === 'add' && v?.type === 'text' ? '+ Append' : VAR_OP_LABELS[op]}</option>)}
          </select>
        </Field>
        {a.op !== 'toggle' && (
          <Field label={useVar ? 'Variable' : 'Value'}>
            {useVar ? (
              <select value={a.fromVariableId!} onChange={(ev) => onChange({ ...a, fromVariableId: ev.target.value })}>{varOptions}<optgroup label="Built-in">{BUILTIN_VARIABLES.map((b) => <option key={b} value={b}>{b}</option>)}</optgroup></select>
            ) : v?.type === 'boolean' ? (
              <select value={String(a.value)} onChange={(ev) => onChange({ ...a, value: ev.target.value === 'true' })}><option value="true">True</option><option value="false">False</option></select>
            ) : (
              <input type={v?.type === 'number' ? 'number' : 'text'} value={String(a.value)} onChange={(ev) => onChange({ ...a, value: v?.type === 'number' ? Number(ev.target.value) || 0 : ev.target.value })} />
            )}
          </Field>
        )}
      </div>
      {a.op !== 'toggle' && (
        <label className="check text-[12px]"><input type="checkbox" checked={useVar} onChange={(ev) => onChange({ ...a, fromVariableId: ev.target.checked ? (course.variables[0]?.id ?? null) : null })} /> Use the value of another variable</label>
      )}
    </>
  );
}
