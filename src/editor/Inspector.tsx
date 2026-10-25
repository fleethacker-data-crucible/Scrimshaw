// Right-hand inspector: design, states, triggers and timing for the selection; slide, triggers
// and question settings when nothing is selected.
import { useState, type ReactNode } from 'react';
import { newVariable, PALETTE, uid } from '../model/factory.ts';
import { describeTrigger } from '../model/describe.ts';
import { findLayer, findObject, findSlide } from '../model/query.ts';
import { BUILTIN_STATES, type AnimationType, type ID, type ObjectState, type ShapeKind, type Slide, type SlideObject, type Style, type Trigger } from '../model/types.ts';
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Pencil, Plus, Trash, Zap } from '../ui/icons.tsx';
import { Button, Field, IconButton, NumberInput, Select, Tabs, useUi } from '../ui/kit.tsx';
import { fileToAsset, imageSize, pickFile, withAsset } from './assets.ts';
import { useEditor } from './context.tsx';
import { TriggerEditor, type TriggerOwner } from './TriggerEditor.tsx';

const ANIMS: { value: AnimationType; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'fade', label: 'Fade' }, { value: 'fly-left', label: 'Fly in from left' },
  { value: 'fly-right', label: 'Fly in from right' }, { value: 'fly-up', label: 'Fly in from bottom' }, { value: 'fly-down', label: 'Fly in from top' },
  { value: 'zoom', label: 'Grow' }, { value: 'wipe', label: 'Wipe' },
];
const SHAPES: { value: ShapeKind; label: string }[] = [
  { value: 'rect', label: 'Rectangle' }, { value: 'round', label: 'Rounded rectangle' }, { value: 'ellipse', label: 'Oval' },
  { value: 'triangle', label: 'Triangle' }, { value: 'arrow', label: 'Arrow' }, { value: 'line', label: 'Line' },
];

export function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const none = value === 'transparent';
  return (
    <div className="grid gap-1">
      <span className="text-[12px] text-fg-2">{label}</span>
      <div className="flex items-center gap-1">
        <input type="color" aria-label={label} value={none ? '#ffffff' : toHex(value)} onChange={(e) => onChange(e.target.value)} className="!w-9 shrink-0" />
        <input aria-label={`${label} value`} className="min-w-0 flex-1 font-mono text-[12px]" value={value} onChange={(e) => onChange(e.target.value)} />
        <IconButton label={none ? `${label}: none (click for a colour)` : `Remove ${label.toLowerCase()}`} pressed={none} onClick={() => onChange(none ? '#2f74c8' : 'transparent')}>
          {none ? <EyeOff /> : <Eye />}
        </IconButton>
      </div>
      <div className="flex gap-1" role="group" aria-label={`${label} swatches`}>
        {PALETTE.map((c) => (
          <button key={c} type="button" title={c} aria-label={`${label} ${c}`} onClick={() => onChange(c)}
            className="!h-4 !w-4 !p-0 rounded-sm border border-line-strong" style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function toHex(v: string) {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
  return '#000000';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-2"><h3>{title}</h3>{children}</section>;
}

type ObjTab = 'design' | 'states' | 'triggers' | 'timing';
type SlideTab = 'slide' | 'triggers' | 'question';

export function Inspector({ previewStates, setPreviewState }: { previewStates: Record<ID, string>; setPreviewState: (id: ID, state: string | null) => void }) {
  const { selected } = useEditor();
  const [objTab, setObjTab] = useState<ObjTab>('design');
  const [slideTab, setSlideTab] = useState<SlideTab>('slide');
  return (
    <aside className="pane right" aria-label="Inspector">
      {selected.length > 0 ? (
        <>
          <div className="pane-head !p-0 !block">
            <Tabs label="Object properties" value={objTab} onChange={setObjTab} tabs={[
              { id: 'design', label: 'Design' }, { id: 'states', label: 'States' }, { id: 'triggers', label: 'Triggers' }, { id: 'timing', label: 'Timing' },
            ]} />
          </div>
          <div role="tabpanel" className="insp">
            {objTab === 'design' && <DesignTab />}
            {objTab === 'states' && <StatesTab previewStates={previewStates} setPreviewState={setPreviewState} />}
            {objTab === 'triggers' && <ObjectTriggers />}
            {objTab === 'timing' && <TimingTab />}
          </div>
        </>
      ) : (
        <SlideInspector tab={slideTab} setTab={setSlideTab} />
      )}
    </aside>
  );
}

// ---------- design ----------

function DesignTab() {
  const { selected, editSelected, course, edit } = useEditor();
  const { toast } = useUi();
  const o = selected[0];
  const multi = selected.length > 1;
  const set = (label: string, fn: (o: SlideObject) => void, key?: string) => editSelected(label, fn, key);
  const setStyle = <K extends keyof Style>(k: K, v: Style[K]) => set('Format', (x) => { x.style[k] = v; }, `style-${k}`);
  const hasText = ['text', 'shape', 'button', 'choice', 'input'].includes(o.kind);
  const hasFill = o.kind !== 'image' && o.kind !== 'hotspot' && o.kind !== 'video';

  const replaceMedia = async (kind: 'image' | 'video' | 'audio') => {
    const file = await pickFile(`${kind}/*`);
    if (!file) return;
    try {
      const asset = await fileToAsset(file, kind);
      const size = kind === 'image' ? await imageSize(asset.data, course.size.w * 0.8, course.size.h * 0.8) : null;
      edit(kind === 'image' ? 'Replace image' : kind === 'video' ? 'Set video' : 'Set audio', (c, sel) => {
        withAsset(c, asset);
        const obj = findObject(findSlide(c, sel.slideId)!, o.id)!;
        obj.src = `asset:${asset.id}`;
        if (size && obj.kind === 'image') { obj.w = size.w; obj.h = size.h; }
        if (!obj.alt) obj.alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      });
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <>
      {!multi && (
        <Field label="Name" hint="Shown in triggers and the timeline.">
          <input value={o.name} onChange={(e) => set('Rename', (x) => { x.name = e.target.value; }, `name-${o.id}`)} />
        </Field>
      )}
      {multi && <p className="muted text-[13px]">{selected.length} objects selected. Changes apply to all of them.</p>}
      <Section title="Position and size">
        <div className="grid-4">
          <NumberInput label="X" value={o.x} onChange={(v) => set('Move', (x) => { x.x = v; }, 'pos-x')} />
          <NumberInput label="Y" value={o.y} onChange={(v) => set('Move', (x) => { x.y = v; }, 'pos-y')} />
          <NumberInput label="Width" min={1} value={o.w} onChange={(v) => set('Resize', (x) => { x.w = v; }, 'size-w')} />
          <NumberInput label="Height" min={1} value={o.h} onChange={(v) => set('Resize', (x) => { x.h = v; }, 'size-h')} />
        </div>
        <div className="grid-2 text-[11px] text-muted -mt-1"><span>X · Y · W · H (px)</span></div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-fg-2 w-16">Rotation</span>
          <NumberInput label="Rotation (degrees)" min={-360} max={360} value={o.rotation} onChange={(v) => set('Rotate', (x) => { x.rotation = v; }, 'rot')} className="w-20" />
          <span className="flex-1" />
          <IconButton label={o.locked ? 'Unlock' : 'Lock position'} pressed={o.locked} onClick={() => set(o.locked ? 'Unlock' : 'Lock', (x) => { x.locked = !o.locked; })}>{o.locked ? <Lock /> : <LockOpen />}</IconButton>
        </div>
      </Section>

      {!multi && hasText && (
        <Section title={o.kind === 'input' ? 'Placeholder' : 'Text'}>
          <textarea aria-label="Text" className="!font-sans !text-[13px]" rows={3} value={o.text}
            onChange={(e) => set('Edit text', (x) => { x.text = e.target.value; }, `text-${o.id}`)} />
          <p className="hint">Insert a variable with %Name%, for example %Results.ScorePercent%.</p>
        </Section>
      )}

      {!multi && o.kind === 'shape' && (
        <Field label="Shape">
          <Select label="Shape" value={o.shape} options={SHAPES} onChange={(v) => set('Change shape', (x) => { x.shape = v; })} />
        </Field>
      )}

      {hasText && (
        <Section title="Font">
          <div className="grid-2">
            <Field label="Size"><NumberInput label="Font size" min={6} max={200} value={o.style.fontSize} onChange={(v) => setStyle('fontSize', v)} /></Field>
            <Field label="Weight">
              <Select label="Font weight" value={String(o.style.fontWeight) as '400'} onChange={(v) => setStyle('fontWeight', Number(v))}
                options={[{ value: '400', label: 'Regular' }, { value: '500', label: 'Medium' }, { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' }]} />
            </Field>
            <Field label="Align">
              <Select label="Horizontal alignment" value={o.style.align} onChange={(v) => setStyle('align', v)} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
            </Field>
            <Field label="Vertical">
              <Select label="Vertical alignment" value={o.style.valign} onChange={(v) => setStyle('valign', v)} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
            </Field>
            <Field label="Family">
              <Select label="Font family" value={o.style.fontFamily} onChange={(v) => setStyle('fontFamily', v)} options={[{ value: 'sans', label: 'Exo 2' }, { value: 'mono', label: 'Syne Mono' }]} />
            </Field>
            <Field label="Line height"><NumberInput label="Line height" min={0.8} max={3} step={0.05} value={o.style.lineHeight} onChange={(v) => setStyle('lineHeight', v)} /></Field>
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" checked={o.style.italic} onChange={(e) => setStyle('italic', e.target.checked)} /> Italic</label>
            <label className="check"><input type="checkbox" checked={o.style.underline} onChange={(e) => setStyle('underline', e.target.checked)} /> Underline</label>
          </div>
          <ColorInput label="Text colour" value={o.style.color} onChange={(v) => setStyle('color', v)} />
        </Section>
      )}

      {hasFill && (
        <Section title="Fill and outline">
          <ColorInput label="Fill" value={o.style.fill} onChange={(v) => setStyle('fill', v)} />
          <ColorInput label="Outline" value={o.style.stroke} onChange={(v) => setStyle('stroke', v)} />
          <div className="grid-2">
            <Field label="Outline width"><NumberInput label="Outline width" min={0} max={40} value={o.style.strokeWidth} onChange={(v) => setStyle('strokeWidth', v)} /></Field>
            <Field label="Corner radius"><NumberInput label="Corner radius" min={0} max={400} value={o.style.radius} onChange={(v) => setStyle('radius', v)} /></Field>
            <Field label="Padding"><NumberInput label="Padding" min={0} max={200} value={o.style.padding} onChange={(v) => setStyle('padding', v)} /></Field>
          </div>
        </Section>
      )}
      <div className="grid-2">
        <Field label="Opacity (%)"><NumberInput label="Opacity" min={0} max={100} value={Math.round(o.style.opacity * 100)} onChange={(v) => setStyle('opacity', v / 100)} /></Field>
        <label className="check mt-5"><input type="checkbox" checked={o.style.shadow} onChange={(e) => setStyle('shadow', e.target.checked)} /> Shadow</label>
      </div>

      {!multi && o.kind === 'image' && (
        <Section title="Image">
          <Button variant="ghost" onClick={() => replaceMedia('image')}><ImageIcon />{o.src ? 'Replace image…' : 'Choose image…'}</Button>
        </Section>
      )}
      {!multi && o.kind === 'video' && (
        <Section title="Video">
          <Button variant="ghost" onClick={() => replaceMedia('video')}>Choose video file…</Button>
          <Field label="Or a video URL" hint="Relative paths work when the file ships beside the published course.">
            <input value={o.src.startsWith('asset:') ? '' : o.src} placeholder="media/intro.mp4" onChange={(e) => set('Video URL', (x) => { x.src = e.target.value; }, `src-${o.id}`)} />
          </Field>
          <div className="row">
            <label className="check"><input type="checkbox" checked={o.autoplay} onChange={(e) => set('Autoplay', (x) => { x.autoplay = e.target.checked; })} /> Autoplay</label>
            <label className="check"><input type="checkbox" checked={o.controls} onChange={(e) => set('Controls', (x) => { x.controls = e.target.checked; })} /> Show controls</label>
            <label className="check"><input type="checkbox" checked={o.loop} onChange={(e) => set('Loop', (x) => { x.loop = e.target.checked; })} /> Loop</label>
          </div>
        </Section>
      )}
      {!multi && o.kind === 'audio' && (
        <Section title="Audio">
          <Button variant="ghost" onClick={() => replaceMedia('audio')}>{o.src ? 'Replace audio file…' : 'Choose audio file…'}</Button>
          <Field label="Or an audio URL" hint="Relative paths work when the file ships beside the published course.">
            <input value={o.src.startsWith('asset:') ? '' : o.src} placeholder="media/narration.mp3" onChange={(e) => set('Audio URL', (x) => { x.src = e.target.value; }, `src-${o.id}`)} />
          </Field>
          <div className="row">
            <label className="check"><input type="checkbox" checked={o.autoplay} onChange={(e) => set('Autoplay', (x) => { x.autoplay = e.target.checked; })} /> Play when it appears</label>
            <label className="check"><input type="checkbox" checked={o.controls} onChange={(e) => set('Controls', (x) => { x.controls = e.target.checked; })} /> Show a play button</label>
            <label className="check"><input type="checkbox" checked={o.loop} onChange={(e) => set('Loop', (x) => { x.loop = e.target.checked; })} /> Loop</label>
          </div>
          <p className="hint">Without a play button the audio is invisible to learners. Set when it starts in the Timing tab; triggers can play and pause it.</p>
        </Section>
      )}
      {!multi && o.kind === 'input' && <InputVariable o={o} />}
      {!multi && o.kind === 'choice' && (
        <Section title="Answer">
          <label className="check"><input type="checkbox" checked={o.correct} onChange={(e) => set('Mark correct', (x) => { x.correct = e.target.checked; })} /> This is a correct answer</label>
          <Field label="Selection">
            <Select label="Selection mode" value={o.choiceMode} onChange={(v) => set('Choice mode', (x) => { x.choiceMode = v; })}
              options={[{ value: 'radio', label: 'One answer (radio)' }, { value: 'check', label: 'Many answers (checkbox)' }]} />
          </Field>
        </Section>
      )}

      {!multi && o.kind !== 'input' && o.kind !== 'video' && o.kind !== 'audio' && (
        <Section title="Drag and drop">
          <label className="check"><input type="checkbox" checked={o.draggable} onChange={(e) => set('Draggable', (x) => { x.draggable = e.target.checked; if (e.target.checked) x.dropTarget = false; })} /> Learner can drag this</label>
          <label className="check"><input type="checkbox" checked={o.dropTarget} onChange={(e) => set('Drop target', (x) => { x.dropTarget = e.target.checked; if (e.target.checked) x.draggable = false; })} /> Drop target</label>
          {o.draggable && <DropTargetPicker o={o} />}
        </Section>
      )}

      <Section title="Accessibility">
        {!multi && (
          <Field label={o.kind === 'image' ? 'Alt text' : 'Accessible name'} hint={o.kind === 'image' ? 'Describe the image for screen readers.' : 'Used when the object has no visible text.'}>
            <input value={o.alt} onChange={(e) => set('Alt text', (x) => { x.alt = e.target.value; }, `alt-${o.id}`)} />
          </Field>
        )}
        <label className="check"><input type="checkbox" checked={o.decorative} onChange={(e) => set('Decorative', (x) => { x.decorative = e.target.checked; })} /> Decorative (hidden from screen readers)</label>
      </Section>
    </>
  );
}

function DropTargetPicker({ o }: { o: SlideObject }) {
  const { slide, editSelected } = useEditor();
  const targets = slide.layers.flatMap((l) => l.objects).filter((x) => x.dropTarget);
  return (
    <Field label="Correct drop target" hint={targets.length ? 'Used to grade drag-and-drop questions.' : 'Mark another object as a drop target first.'}>
      <select value={o.correctTargetId ?? ''} onChange={(e) => editSelected('Correct target', (x) => { x.correctTargetId = e.target.value || null; })}>
        <option value="">None</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </Field>
  );
}

function InputVariable({ o }: { o: SlideObject }) {
  const { course, edit, editSelected } = useEditor();
  const { prompt } = useUi();
  const vars = course.variables.filter((v) => v.type !== 'boolean');
  return (
    <Section title="Stores the answer in">
      <div className="flex gap-1">
        <select aria-label="Variable" className="flex-1" value={o.variableId ?? ''} onChange={(e) => editSelected('Input variable', (x) => { x.variableId = e.target.value || null; })}>
          <option value="">No variable</option>
          {vars.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <Button size="small" variant="ghost" onClick={async () => {
          const name = await prompt({ title: 'New text variable', label: 'Variable name', value: 'TextEntry', ok: 'Create' });
          if (!name) return;
          edit('New variable', (c, sel) => {
            const v = newVariable(uniqueVarName(c.variables.map((x) => x.name), name), 'text', '');
            c.variables.push(v);
            findObject(findSlide(c, sel.slideId)!, o.id)!.variableId = v.id;
          });
        }}><Plus size={14} />New</Button>
      </div>
    </Section>
  );
}

export function uniqueVarName(existing: string[], wanted: string) {
  const base = wanted.replace(/[^A-Za-z0-9_]/g, '') || 'Variable';
  const fixed = /^[A-Za-z_]/.test(base) ? base : `V${base}`;
  const set = new Set(existing.map((e) => e.toLowerCase()));
  if (!set.has(fixed.toLowerCase())) return fixed;
  for (let i = 2; ; i++) if (!set.has(`${fixed}${i}`.toLowerCase())) return `${fixed}${i}`;
}

// ---------- states ----------

function StatesTab({ previewStates, setPreviewState }: { previewStates: Record<ID, string>; setPreviewState: (id: ID, state: string | null) => void }) {
  const { selected, editSelected } = useEditor();
  const { prompt } = useUi();
  const o = selected[0];
  if (selected.length > 1) return <p className="muted text-[13px]">Select one object to edit its states.</p>;
  const missing = BUILTIN_STATES.filter((s) => s !== 'Normal' && s !== 'Hidden' && !o.states.some((x) => x.name === s));
  const add = (name: string) => editSelected('Add state', (x) => { x.states.push({ id: uid('st'), name, style: {}, text: null }); });
  const update = (id: ID, fn: (s: ObjectState) => void, key?: string) => editSelected('Edit state', (x) => { const s = x.states.find((y) => y.id === id); if (s) fn(s); }, key);
  const preview = previewStates[o.id] ?? 'Normal';
  return (
    <>
      <p className="muted text-[13px]">States change how {o.name} looks. Hover and Down apply automatically; Visited applies after a click; Selected is used by choices. Triggers can change to any state.</p>
      <div className="list-row" aria-current={preview === 'Normal'}>
        <span className="grow font-semibold">Normal</span>
        <span className="muted text-[12px]">the object's own design</span>
        <IconButton label="Preview Normal" pressed={preview === 'Normal'} onClick={() => setPreviewState(o.id, null)}><Eye /></IconButton>
      </div>
      {o.states.map((s) => (
        <div key={s.id} className="box !p-2 grid gap-2" aria-label={`State ${s.name}`}>
          <div className="flex items-center gap-1">
            <span className="flex-1 font-semibold">{s.name}</span>
            <IconButton label={`Preview ${s.name}`} pressed={preview === s.name} onClick={() => setPreviewState(o.id, preview === s.name ? null : s.name)}><Eye /></IconButton>
            {!(BUILTIN_STATES as readonly string[]).includes(s.name) && (
              <IconButton label={`Rename ${s.name}`} onClick={async () => {
                const name = await prompt({ title: 'Rename state', label: 'State name', value: s.name, ok: 'Rename' });
                if (name) update(s.id, (x) => { x.name = name; });
              }}><Pencil /></IconButton>
            )}
            <IconButton label={`Delete ${s.name}`} onClick={() => editSelected('Delete state', (x) => { x.states = x.states.filter((y) => y.id !== s.id); })}><Trash /></IconButton>
          </div>
          <ColorInput label="Fill" value={s.style.fill ?? o.style.fill} onChange={(v) => update(s.id, (x) => { x.style.fill = v; }, `sf-${s.id}`)} />
          <ColorInput label="Text colour" value={s.style.color ?? o.style.color} onChange={(v) => update(s.id, (x) => { x.style.color = v; }, `sc-${s.id}`)} />
          <div className="grid-2">
            <Field label="Opacity (%)"><NumberInput label="Opacity" min={0} max={100} value={Math.round((s.style.opacity ?? o.style.opacity) * 100)} onChange={(v) => update(s.id, (x) => { x.style.opacity = v / 100; }, `so-${s.id}`)} /></Field>
            <Field label="Weight">
              <Select label="Font weight" value={String(s.style.fontWeight ?? o.style.fontWeight) as '400'} onChange={(v) => update(s.id, (x) => { x.style.fontWeight = Number(v); })}
                options={[{ value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' }]} />
            </Field>
          </div>
          <Field label="Text in this state" hint="Leave empty to keep the normal text.">
            <input value={s.text ?? ''} onChange={(e) => update(s.id, (x) => { x.text = e.target.value === '' ? null : e.target.value; }, `st-${s.id}`)} />
          </Field>
        </div>
      ))}
      <div className="row">
        {missing.map((m) => <Button key={m} size="small" variant="ghost" onClick={() => add(m)}><Plus size={14} />{m}</Button>)}
        <Button size="small" variant="ghost" onClick={async () => {
          const name = await prompt({ title: 'New state', label: 'State name', value: 'Custom', ok: 'Add' });
          if (name && !o.states.some((x) => x.name.toLowerCase() === name.toLowerCase()) && name !== 'Normal') add(name);
        }}><Plus size={14} />Custom…</Button>
      </div>
      <label className="check"><input type="checkbox" checked={o.initiallyHidden} onChange={(e) => editSelected('Initial state', (x) => { x.initiallyHidden = e.target.checked; })} /> Start hidden (a trigger can show it)</label>
    </>
  );
}

// ---------- timing ----------

function TimingTab() {
  const { selected, editSelected, slide } = useEditor();
  const o = selected[0];
  return (
    <>
      <Section title="Timeline">
        <div className="grid-2">
          <Field label="Appears at (s)"><NumberInput label="Appears at" min={0} max={slide.duration} step={0.1} value={o.start} onChange={(v) => editSelected('Timing', (x) => { x.start = v; if (x.end !== null && x.end <= v) x.end = null; }, 'start')} /></Field>
          <Field label="Disappears at (s)" hint="Empty: stays to the end.">
            <input type="number" min={0} step={0.1} value={o.end ?? ''} placeholder="End of slide"
              onChange={(e) => editSelected('Timing', (x) => { const n = Number(e.target.value); x.end = e.target.value === '' || !Number.isFinite(n) || n <= x.start ? null : n; }, 'end')} />
          </Field>
        </div>
      </Section>
      <Section title="Entrance animation">
        <div className="grid-2">
          <Field label="Effect"><Select label="Entrance effect" value={o.enter.type} options={ANIMS} onChange={(v) => editSelected('Animation', (x) => { x.enter = { ...x.enter, type: v }; })} /></Field>
          <Field label="Duration (s)"><NumberInput label="Animation duration" min={0.1} max={10} step={0.1} value={o.enter.duration} onChange={(v) => editSelected('Animation', (x) => { x.enter = { ...x.enter, duration: v }; }, 'anim-d')} /></Field>
        </div>
      </Section>
      <Section title="Exit animation">
        <div className="grid-2">
          <Field label="Effect"><Select label="Exit effect" value={o.exit.type} options={ANIMS} onChange={(v) => editSelected('Animation', (x) => { x.exit = { ...x.exit, type: v }; })} /></Field>
          <Field label="Duration (s)"><NumberInput label="Exit duration" min={0.1} max={10} step={0.1} value={o.exit.duration} onChange={(v) => editSelected('Animation', (x) => { x.exit = { ...x.exit, duration: v }; }, 'anim-x')} /></Field>
        </div>
        <p className="hint">{o.end === null ? 'Plays when the object disappears; set “Disappears at” above.' : `Plays at ${o.end}s.`} Animations are skipped for learners who prefer reduced motion.</p>
      </Section>
    </>
  );
}

// ---------- triggers ----------

export function TriggerList({ owner, triggers, ownerObj, onChange }: { owner: TriggerOwner; triggers: Trigger[]; ownerObj: SlideObject | null; onChange: (label: string, next: Trigger[]) => void }) {
  const { course, slide } = useEditor();
  const [editing, setEditing] = useState<Trigger | 'new' | null>(null);
  const move = (i: number, d: number) => {
    const n = [...triggers];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onChange('Reorder triggers', n);
  };
  return (
    <div className="grid gap-2">
      {triggers.length === 0 && <p className="muted text-[13px]">No triggers yet.</p>}
      {triggers.map((t, i) => {
        const d = describeTrigger(course, slide, t, ownerObj);
        return (
          <div key={t.id} className="list-row !items-start" style={t.enabled ? undefined : { opacity: 0.6 }}>
            <Zap size={14} className="mt-0.5 shrink-0 text-brand" />
            <button type="button" className="grow trigger-text !h-auto !p-0 !bg-transparent !text-fg !font-normal !block text-left !whitespace-normal" onClick={() => setEditing(t)} aria-label={`Edit trigger: ${d.action} when ${d.when}`}>
              <b>{d.action}</b><br /><span className="when">When {d.when}{d.conditions && <> · if {d.conditions}</>}{!t.enabled && ' · disabled'}</span>
            </button>
            <div className="flex flex-col">
              <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="!h-5"><ArrowUp size={12} /></IconButton>
              <IconButton label="Move down" disabled={i === triggers.length - 1} onClick={() => move(i, 1)} className="!h-5"><ArrowDown size={12} /></IconButton>
            </div>
            <IconButton label="Delete trigger" onClick={() => onChange('Delete trigger', triggers.filter((x) => x.id !== t.id))}><Trash /></IconButton>
          </div>
        );
      })}
      <Button variant="ghost" onClick={() => setEditing('new')}><Plus />New trigger</Button>
      {editing && (
        <TriggerEditor course={course} slide={slide} owner={owner} trigger={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            onChange(editing === 'new' ? 'Add trigger' : 'Edit trigger', editing === 'new' ? [...triggers, t] : triggers.map((x) => (x.id === t.id ? t : x)));
            setEditing(null);
          }} />
      )}
    </div>
  );
}

function ObjectTriggers() {
  const { selected, editSelected } = useEditor();
  if (selected.length > 1) return <p className="muted text-[13px]">Select one object to edit its triggers.</p>;
  const o = selected[0];
  return (
    <TriggerList owner={{ kind: 'object', objectId: o.id }} ownerObj={o} triggers={o.triggers}
      onChange={(label, next) => editSelected(label, (x) => { x.triggers = next; })} />
  );
}

// ---------- slide ----------

function SlideInspector({ tab, setTab }: { tab: SlideTab; setTab: (t: SlideTab) => void }) {
  const { slide, layer, edit } = useEditor();
  const tabs: { id: SlideTab; label: string }[] = [{ id: 'slide', label: 'Slide' }, { id: 'triggers', label: 'Triggers' }];
  if (slide.question) tabs.push({ id: 'question', label: 'Question' });
  const current = tab === 'question' && !slide.question ? 'slide' : tab;
  const editSlide = (label: string, fn: (s: Slide) => void, key?: string) => edit(label, (c, sel) => { fn(findSlide(c, sel.slideId)!); }, key);
  return (
    <>
      <div className="pane-head !p-0 !block"><Tabs label="Slide properties" value={current} onChange={setTab} tabs={tabs} /></div>
      <div role="tabpanel" className="insp">
        {current === 'slide' && <SlideProps editSlide={editSlide} />}
        {current === 'triggers' && (
          <>
            <Section title="Slide triggers">
              <TriggerList owner={{ kind: 'slide' }} ownerObj={null} triggers={slide.triggers} onChange={(label, next) => editSlide(label, (s) => { s.triggers = next; })} />
            </Section>
            {!layer.base && (
              <Section title={`Layer: ${layer.name}`}>
                <TriggerList owner={{ kind: 'layer', layerId: layer.id }} ownerObj={null} triggers={layer.triggers}
                  onChange={(label, next) => editSlide(label, (s) => { findLayer(s, layer.id)!.triggers = next; })} />
              </Section>
            )}
            <p className="hint">Object triggers live on each object: select it and open its Triggers tab.</p>
          </>
        )}
        {current === 'question' && <QuestionProps editSlide={editSlide} />}
      </div>
    </>
  );
}

function SlideProps({ editSlide }: { editSlide: (label: string, fn: (s: Slide) => void, key?: string) => void }) {
  const { slide, edit, course } = useEditor();
  const { toast } = useUi();
  const bgImage = slide.background.startsWith('asset:');
  return (
    <>
      <Field label="Title"><input value={slide.title} onChange={(e) => editSlide('Rename slide', (s) => { s.title = e.target.value; }, `title-${slide.id}`)} /></Field>
      {!bgImage && <ColorInput label="Background" value={slide.background} onChange={(v) => editSlide('Background', (s) => { s.background = v; }, 'bg')} />}
      <div className="row">
        <Button size="small" variant="ghost" onClick={async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          try {
            const a = await fileToAsset(f, 'image');
            edit('Background image', (c, sel) => { withAsset(c, a); findSlide(c, sel.slideId)!.background = `asset:${a.id}`; });
          } catch (e) { toast((e as Error).message, 'err'); }
        }}><ImageIcon size={14} />{bgImage ? 'Replace background image' : 'Background image…'}</Button>
        {bgImage && <Button size="small" variant="ghost" onClick={() => editSlide('Background', (s) => { s.background = '#ffffff'; })}>Remove image</Button>}
      </div>
      <div className="grid-2">
        <Field label="Timeline (s)"><NumberInput label="Slide duration" min={0.5} max={3600} step={0.5} value={slide.duration} onChange={(v) => editSlide('Slide duration', (s) => { s.duration = v; }, 'dur')} /></Field>
        <Field label="Advance">
          <Select label="Advance" value={slide.advance} onChange={(v) => editSlide('Advance', (s) => { s.advance = v; })}
            options={[{ value: 'user', label: 'By learner' }, { value: 'auto', label: 'Automatically' }]} />
        </Field>
      </div>
      <label className="check"><input type="checkbox" checked={slide.inMenu} onChange={(e) => editSlide('Menu', (s) => { s.inMenu = e.target.checked; })} /> Show in the player menu</label>
      <Field label="Notes" hint={`Private to authors. ${course.title ? '' : ''}`}>
        <textarea className="!font-sans !text-[13px]" rows={4} value={slide.notes} onChange={(e) => editSlide('Notes', (s) => { s.notes = e.target.value; }, `notes-${slide.id}`)} />
      </Field>
      <p className="hint">Select an object on the canvas to edit it, or drag on empty space to select several.</p>
    </>
  );
}

function QuestionProps({ editSlide }: { editSlide: (label: string, fn: (s: Slide) => void, key?: string) => void }) {
  const { slide } = useEditor();
  const q = slide.question!;
  const layers = slide.layers.filter((l) => !l.base);
  const layerSelect = (label: string, value: ID | null, pick: (q: NonNullable<Slide['question']>, id: ID | null) => void) => (
    <Field label={label}>
      <select value={value ?? ''} onChange={(e) => editSlide('Question feedback', (s) => pick(s.question!, e.target.value || null))}>
        <option value="">None</option>
        {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </Field>
  );
  const choices = slide.layers.flatMap((l) => l.objects).filter((o) => o.kind === 'choice');
  return (
    <>
      <p className="muted text-[13px]">{{ 'multiple-choice': 'Multiple choice', 'multiple-response': 'Multiple response', 'true-false': 'True / false', 'fill-in': 'Fill in the blank', 'drag-drop': 'Drag and drop' }[q.kind]} question. The Submit button runs “Submit interaction”.</p>
      <div className="grid-2">
        <Field label="Points"><NumberInput label="Points" min={0} max={1000} value={q.points} onChange={(v) => editSlide('Points', (s) => { s.question!.points = v; }, 'pts')} /></Field>
        <Field label="Attempts" hint="0 = unlimited"><NumberInput label="Attempts" min={0} max={99} value={q.attempts} onChange={(v) => editSlide('Attempts', (s) => { s.question!.attempts = v; }, 'att')} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={q.graded} onChange={(e) => editSlide('Graded', (s) => { s.question!.graded = e.target.checked; })} /> Graded (counts toward the score)</label>
      {q.kind !== 'fill-in' && (
        <label className="check"><input type="checkbox" checked={q.shuffle} onChange={(e) => editSlide('Shuffle', (s) => { s.question!.shuffle = e.target.checked; })} /> Shuffle {q.kind === 'drag-drop' ? 'items' : 'answers'} each time</label>
      )}
      {q.kind === 'drag-drop' ? (
        <Section title="Where each item belongs">
          {slide.layers.flatMap((l) => l.objects).filter((o) => o.draggable).map((item) => (
            <Field key={item.id} label={item.text || item.name}>
              <select value={item.correctTargetId ?? ''} onChange={(e) => editSlide('Correct target', (s) => {
                for (const l of s.layers) for (const o of l.objects) if (o.id === item.id) o.correctTargetId = e.target.value || null;
              })}>
                <option value="">Anywhere (not graded)</option>
                {slide.layers.flatMap((l) => l.objects).filter((o) => o.dropTarget).map((t) => <option key={t.id} value={t.id}>{t.text || t.name}</option>)}
              </select>
            </Field>
          ))}
          <p className="hint">Make any object draggable or a drop target in its Design tab.</p>
        </Section>
      ) : q.kind === 'fill-in' ? (
        <>
          <Field label="Accepted answers" hint="One per line. Matching ignores case and extra spaces.">
            <textarea className="!font-sans !text-[13px]" rows={4} value={q.accepted.join('\n')} onChange={(e) => editSlide('Accepted answers', (s) => { s.question!.accepted = e.target.value.split('\n'); }, 'acc')} />
          </Field>
          <Field label="Answer box">
            <select value={q.inputObjectId ?? ''} onChange={(e) => editSlide('Answer box', (s) => { s.question!.inputObjectId = e.target.value || null; })}>
              <option value="">None</option>
              {slide.layers.flatMap((l) => l.objects).filter((o) => o.kind === 'input').map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <Section title="Correct answers">
          {choices.map((c) => (
            <label key={c.id} className="check">
              <input type={q.kind === 'multiple-response' ? 'checkbox' : 'radio'} name="correct" checked={c.correct}
                onChange={(e) => editSlide('Mark correct', (s) => {
                  for (const l of s.layers) for (const o of l.objects) if (o.kind === 'choice') {
                    if (o.id === c.id) o.correct = q.kind === 'multiple-response' ? e.target.checked : true;
                    else if (q.kind !== 'multiple-response') o.correct = false;
                  }
                })} />
              {c.text || c.name}
            </label>
          ))}
          {choices.length === 0 && <p className="muted text-[13px]">Insert Choice objects to add answers.</p>}
        </Section>
      )}
      <Section title="Feedback layers">
        {layerSelect('Correct', q.correctLayerId, (x, id) => { x.correctLayerId = id; })}
        {layerSelect('Incorrect', q.incorrectLayerId, (x, id) => { x.incorrectLayerId = id; })}
        {layerSelect('Try again', q.tryAgainLayerId, (x, id) => { x.tryAgainLayerId = id; })}
      </Section>
    </>
  );
}
