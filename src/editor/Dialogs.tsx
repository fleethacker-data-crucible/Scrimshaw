import { useEffect, useState } from 'react';
import { newVariable } from '../model/factory.ts';
import { validateCourse } from '../model/describe.ts';
import { allSlides, slideTriggers } from '../model/query.ts';
import type { Course, ID, VariableType } from '../model/types.ts';
import { buildPlayerHtml, buildScormZip, buildXapiZip, canPublish, download, fileName } from '../export/publish.ts';
import { serializeCourse } from '../model/schema.ts';
import { contrast, findTexts, replaceAll } from '../model/texts.ts';
import { deleteProject, listProjects, type ProjectMeta } from '../store/persist.ts';
import { Download, FileBraces, Globe, Package, Plus, Trash, TriangleAlert } from '../ui/icons.tsx';
import { Button, Dialog, Field, IconButton, NumberInput, Select, useUi } from '../ui/kit.tsx';
import { useEditor } from './context.tsx';
import { ColorInput, uniqueVarName } from './Inspector.tsx';

// ---------- variables ----------

function usageCount(c: Course, id: ID): number {
  let n = 0;
  const json = (x: unknown) => JSON.stringify(x);
  for (const sl of allSlides(c)) {
    for (const { trigger } of slideTriggers(sl)) if (json(trigger).includes(`"${id}"`)) n++;
    for (const l of sl.layers) for (const o of l.objects) {
      if (o.variableId === id) n++;
      const v = c.variables.find((x) => x.id === id);
      if (v && o.text.toLowerCase().includes(`%${v.name.toLowerCase()}%`)) n++;
    }
  }
  return n;
}

export function VariablesDialog({ onClose }: { onClose: () => void }) {
  const { course, edit } = useEditor();
  const { confirm } = useUi();
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('text');
  const nameOk = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !course.variables.some((v) => v.name.toLowerCase() === name.toLowerCase());
  const editVar = (id: ID, label: string, fn: (v: Course['variables'][number]) => void, key?: string) =>
    edit(label, (c) => { const v = c.variables.find((x) => x.id === id); if (v) fn(v); }, key);
  return (
    <Dialog title="Variables" onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      <p className="muted text-[13px]">Variables remember things for the whole course. Show one in text with %Name%; change one with an “Adjust variable” trigger; test one in a trigger condition.</p>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Project variables">
        <table className="grid">
          <caption>Project variables</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Initial value</th><th scope="col" className="num">Used</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {course.variables.length === 0 && <tr><td colSpan={5} className="muted">No variables yet.</td></tr>}
            {course.variables.map((v) => (
              <tr key={v.id}>
                <td><input aria-label="Variable name" value={v.name} className="w-40 font-mono" onChange={(e) => {
                  const n = e.target.value.replace(/[^A-Za-z0-9_]/g, '');
                  if (n && !course.variables.some((x) => x.id !== v.id && x.name.toLowerCase() === n.toLowerCase())) editVar(v.id, 'Rename variable', (x) => { x.name = n; }, `vn-${v.id}`);
                }} /></td>
                <td>{v.type === 'text' ? 'Text' : v.type === 'number' ? 'Number' : 'True/False'}</td>
                <td>
                  {v.type === 'boolean' ? (
                    <select aria-label="Initial value" value={String(v.initial)} onChange={(e) => editVar(v.id, 'Initial value', (x) => { x.initial = e.target.value === 'true'; })}><option value="false">False</option><option value="true">True</option></select>
                  ) : v.type === 'number' ? (
                    <NumberInput label="Initial value" value={Number(v.initial) || 0} onChange={(n) => editVar(v.id, 'Initial value', (x) => { x.initial = n; }, `vi-${v.id}`)} className="w-24" />
                  ) : (
                    <input aria-label="Initial value" value={String(v.initial)} onChange={(e) => editVar(v.id, 'Initial value', (x) => { x.initial = e.target.value; }, `vi-${v.id}`)} />
                  )}
                </td>
                <td className="num">{usageCount(course, v.id)}</td>
                <td>
                  <IconButton label={`Delete ${v.name}`} onClick={async () => {
                    const used = usageCount(course, v.id);
                    if (used > 0 && !(await confirm({ title: 'Delete variable?', message: `${v.name} is used ${used} time(s). Triggers that change it will stop working.`, ok: 'Delete', danger: true }))) return;
                    edit('Delete variable', (c) => { c.variables = c.variables.filter((x) => x.id !== v.id); });
                  }}><Trash /></IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="flex items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!nameOk) return;
        edit('New variable', (c) => { c.variables.push(newVariable(uniqueVarName(c.variables.map((v) => v.name), name), type)); });
        setName('');
      }}>
        <Field label="New variable" hint="Letters, digits and underscores; starts with a letter." className="flex-1">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={name !== '' && !nameOk} placeholder="Score" />
        </Field>
        <Field label="Type">
          <Select label="Variable type" value={type} onChange={setType} options={[{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'boolean', label: 'True/False' }]} />
        </Field>
        <Button type="submit" disabled={!nameOk} className="mb-[18px]"><Plus />Add</Button>
      </form>
    </Dialog>
  );
}

// ---------- course settings ----------

export function CourseDialog({ onClose }: { onClose: () => void }) {
  const { course, edit } = useEditor();
  const set = (label: string, fn: (c: Course) => void, key?: string) => edit(label, fn, key);
  const p = course.player;
  return (
    <Dialog title="Course settings" onClose={onClose} wide footer={<Button onClick={onClose}>Done</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title" className="col-span-2"><input value={course.title} onChange={(e) => set('Course title', (c) => { c.title = e.target.value; }, 'ctitle')} /></Field>
        <Field label="Author"><input value={course.author} onChange={(e) => set('Author', (c) => { c.author = e.target.value; }, 'cauthor')} /></Field>
        <Field label="Slide size">
          <Select label="Slide size" value={`${course.size.w}x${course.size.h}`} onChange={(v) => set('Slide size', (c) => { const [w, h] = v.split('x').map(Number); c.size = { w, h }; })}
            options={[{ value: '960x540', label: '16:9 (960 × 540)' }, { value: '1280x720', label: '16:9 (1280 × 720)' }, { value: '720x540', label: '4:3 (720 × 540)' }, { value: '540x960', label: '9:16 portrait (540 × 960)' }]} />
        </Field>
        <Field label="Description" className="col-span-2"><textarea className="!font-sans !text-[13px]" rows={2} value={course.description} onChange={(e) => set('Description', (c) => { c.description = e.target.value; }, 'cdesc')} /></Field>
      </div>
      <fieldset>
        <legend>Player</legend>
        <div className="grid grid-cols-2 gap-2">
          {([['showMenu', 'Menu'], ['showNav', 'Prev / Next bar'], ['showSeekbar', 'Seekbar'], ['showTitle', 'Course title'], ['resume', 'Resume where the learner left off']] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={p[k]} onChange={(e) => set('Player setting', (c) => { c.player[k] = e.target.checked; })} /> {label}</label>
          ))}
          <div className="col-span-2 grid gap-1">
            <ColorInput label="Player accent (buttons, seekbar)" value={p.accent || '#2f74c8'} onChange={(v) => set('Player accent', (c) => { c.player.accent = v === 'transparent' ? '' : v; }, 'accent')} />
            {p.accent && (contrast(p.accent, '#ffffff') ?? 21) < 4.5 && (
              <div className="notice warn"><b>!</b>White button text on this colour is {contrast(p.accent, '#ffffff')!.toFixed(2)}:1, below the 4.5:1 AA minimum. Pick a darker colour.</div>
            )}
          </div>
          <Field label="Menu navigation">
            <Select label="Menu navigation" value={p.navigation} onChange={(v) => set('Player setting', (c) => { c.player.navigation = v; })} options={[{ value: 'free', label: 'Free' }, { value: 'restricted', label: 'Restricted to visited slides' }]} />
          </Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>Resources</legend>
        <div className="grid gap-1">
          {p.resources.map((r, i) => (
            <div key={i} className="flex gap-1 items-center">
              <input aria-label="Resource title" className="flex-1" value={r.title} onChange={(e) => set('Resource', (c) => { c.player.resources[i].title = e.target.value; }, `rt${i}`)} />
              <input aria-label="Resource link" className="flex-1 font-mono text-[12px]" value={r.url} aria-invalid={!/^(https?:|mailto:)/i.test(r.url)} onChange={(e) => set('Resource', (c) => { c.player.resources[i].url = e.target.value; }, `ru${i}`)} />
              <IconButton label={`Remove ${r.title}`} onClick={() => set('Remove resource', (c) => { c.player.resources.splice(i, 1); })}><Trash /></IconButton>
            </div>
          ))}
          <div><Button size="small" variant="ghost" onClick={() => set('Add resource', (c) => { c.player.resources.push({ title: 'New resource', url: 'https://' }); })}><Plus size={14} />Add link</Button></div>
          <p className="hint">Links must start with https://, http:// or mailto:. Others are dropped when the course is saved.</p>
        </div>
      </fieldset>
      <fieldset>
        <legend>Glossary</legend>
        <div className="grid gap-1">
          {p.glossary.map((g, i) => (
            <div key={i} className="flex gap-1 items-start">
              <input aria-label="Term" className="w-40" value={g.term} onChange={(e) => set('Glossary', (c) => { c.player.glossary[i].term = e.target.value; }, `gt${i}`)} />
              <textarea aria-label="Definition" rows={1} className="flex-1 !font-sans !text-[13px] !min-h-[25px]" value={g.definition} onChange={(e) => set('Glossary', (c) => { c.player.glossary[i].definition = e.target.value; }, `gd${i}`)} />
              <IconButton label={`Remove ${g.term}`} onClick={() => set('Remove term', (c) => { c.player.glossary.splice(i, 1); })}><Trash /></IconButton>
            </div>
          ))}
          <div><Button size="small" variant="ghost" onClick={() => set('Add term', (c) => { c.player.glossary.push({ term: 'Term', definition: '' }); })}><Plus size={14} />Add term</Button></div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Quiz and reporting</legend>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Passing score (%)"><NumberInput label="Passing score" min={0} max={100} value={course.quiz.passPercent} onChange={(v) => set('Passing score', (c) => { c.quiz.passPercent = v; }, 'pass')} /></Field>
          <Field label="Report to the LMS as">
            <Select label="Reporting" value={course.quiz.reporting} onChange={(v) => set('Reporting', (c) => { c.quiz.reporting = v; })} options={[{ value: 'passed-failed', label: 'Passed / failed' }, { value: 'completed-incomplete', label: 'Completed / incomplete' }]} />
          </Field>
          <Field label="Course completes on" className="col-span-2">
            <select value={course.quiz.completionSlideId ?? ''} onChange={(e) => set('Completion slide', (c) => { c.quiz.completionSlideId = e.target.value || null; })}>
              <option value="">The last slide</option>
              {allSlides(course).map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>
    </Dialog>
  );
}

// ---------- projects ----------

export function ProjectsDialog({ currentId, onOpen, onNew, onImport, onSample, onClose }: {
  currentId: ID; onOpen: (id: ID) => void; onNew: () => void; onImport: () => void; onSample: () => void; onClose: () => void;
}) {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useUi();
  const refresh = () => listProjects().then(setList).catch((e: Error) => setError(`Saved projects are unavailable in this browser (${e.message}). Use Save to file instead.`));
  useEffect(() => { void refresh(); }, []);
  return (
    <Dialog title="Projects" onClose={onClose} wide footer={
      <>
        <Button variant="ghost" onClick={onSample}>Open the sample course</Button>
        <Button variant="ghost" onClick={onImport}>Open a .scrim file…</Button>
        <Button onClick={onNew}><Plus />New course</Button>
      </>
    }>
      <p className="muted text-[13px]">Projects save automatically in this browser. Use File › Save to file for a backup you can move or share.</p>
      {error && <div className="notice warn"><b>!</b>{error}</div>}
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Saved projects">
        <table className="grid">
          <caption>Saved in this browser</caption>
          <thead><tr><th scope="col">Title</th><th scope="col" className="num">Slides</th><th scope="col">Last saved</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {list === null && !error && <tr><td colSpan={4} className="muted">Loading…</td></tr>}
            {list?.length === 0 && <tr><td colSpan={4} className="muted">Nothing saved yet.</td></tr>}
            {list?.map((p) => (
              <tr key={p.id} className={p.id === currentId ? 'sel' : 'click'} onClick={() => p.id !== currentId && onOpen(p.id)}>
                <td><button type="button" className="!bg-transparent !text-fg !p-0 !font-semibold" onClick={(e) => { e.stopPropagation(); if (p.id !== currentId) onOpen(p.id); }} aria-current={p.id === currentId ? 'true' : undefined}>{p.title || 'Untitled'}</button>{p.id === currentId && <span className="badge blue ml-2">Open</span>}</td>
                <td className="num">{p.slides}</td>
                <td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.modified))}</td>
                <td>
                  <IconButton label={`Delete ${p.title}`} disabled={p.id === currentId} onClick={async (e) => {
                    e.stopPropagation();
                    if (!(await confirm({ title: 'Delete project?', message: `“${p.title}” will be removed from this browser. This cannot be undone.`, ok: 'Delete', danger: true }))) return;
                    await deleteProject(p.id);
                    void refresh();
                  }}><Trash /></IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

// ---------- publish ----------

export function PublishDialog({ onClose }: { onClose: () => void }) {
  const { course } = useEditor();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const problems = validateCourse(course);
  const ready = canPublish();
  const run = async (kind: 'html' | 'scorm' | 'scorm2004' | 'xapi' | 'cmi5' | 'json') => {
    setBusy(true);
    try {
      if (kind === 'json') download(fileName(course.title, 'scrim'), serializeCourse(course), 'application/json');
      if (kind === 'html') download(fileName(course.title, 'html'), buildPlayerHtml(course), 'text/html');
      if (kind === 'scorm') download(fileName(course.title, 'scorm12.zip'), await buildScormZip(course));
      if (kind === 'scorm2004') download(fileName(course.title, 'scorm2004.zip'), await buildScormZip(course, undefined, '2004'));
      if (kind === 'xapi') download(fileName(course.title, 'xapi.zip'), await buildXapiZip(course));
      if (kind === 'cmi5') download(fileName(course.title, 'cmi5.zip'), await buildXapiZip(course, undefined, 'cmi5'));
      toast(kind !== 'html' && kind !== 'json' ? 'Package downloaded. Upload the zip to your LMS.' : 'Downloaded.', 'ok');
    } catch (e) {
      toast(`Publishing failed: ${(e as Error).message}`, 'err');
    } finally { setBusy(false); }
  };
  return (
    <Dialog title="Publish" onClose={onClose} wide={640} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {!ready && <div className="notice warn"><b>!</b>Publishing needs the built app (dist/index.html). In a development build, run <code>npm run build</code> and open dist/index.html.</div>}
      {problems.length > 0 && (
        <div className="notice warn" role="status">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <div><b>{problems.length} thing(s) to check</b>
            <ul className="mt-1 list-disc pl-4 text-[12px]">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>
            {problems.length > 8 && <p className="text-[12px]">…and {problems.length - 8} more.</p>}
          </div>
        </div>
      )}
      <div className="grid gap-2">
        <div className="box flex items-center gap-3">
          <Package size={22} />
          <div className="flex-1"><b>SCORM package</b><p className="muted text-[12px] !m-0">A zip for your LMS: SCORM 1.2 (widest support) or SCORM 2004 3rd Edition. Reports completion, pass/fail, score and time, and resumes where the learner left off.</p></div>
          <Button disabled={!ready || busy} onClick={() => run('scorm')} aria-label="Download SCORM 1.2 zip"><Download />1.2</Button>
          <Button disabled={!ready || busy} onClick={() => run('scorm2004')} aria-label="Download SCORM 2004 zip"><Download />2004</Button>
        </div>
        <div className="box flex items-center gap-3">
          <Package size={22} />
          <div className="flex-1"><b>xAPI package</b><p className="muted text-[12px] !m-0">For an LRS-backed LMS: Tin Can, or cmi5 (the xAPI profile newer LMSs prefer). Sends statements for the attempt, answers and result, and resumes through the xAPI State API.</p></div>
          <Button disabled={!ready || busy} onClick={() => run('xapi')} aria-label="Download xAPI Tin Can zip"><Download />Tin Can</Button>
          <Button disabled={!ready || busy} onClick={() => run('cmi5')} aria-label="Download cmi5 zip"><Download />cmi5</Button>
        </div>
        <div className="box flex items-center gap-3">
          <Globe size={22} />
          <div className="flex-1"><b>Web page</b><p className="muted text-[12px] !m-0">One self-contained HTML file. Works offline, from a file share, or on any web server.</p></div>
          <Button disabled={!ready || busy} onClick={() => run('html')}><Download />HTML</Button>
        </div>
        <div className="box flex items-center gap-3">
          <FileBraces size={22} />
          <div className="flex-1"><b>Project file</b><p className="muted text-[12px] !m-0">The editable .scrim source, to back up or share with another author.</p></div>
          <Button variant="ghost" disabled={busy} onClick={() => run('json')}><Download />.scrim</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- shortcuts ----------

export const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S', 'Save now'], ['Ctrl+H', 'Find and replace'], ['F5', 'Preview from this slide'], ['Ctrl+M', 'New slide'],
  ['Ctrl+C / X / V', 'Copy, cut, paste objects'], ['Ctrl+D', 'Duplicate objects'], ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'], ['Ctrl+Alt+C / Ctrl+Alt+V', 'Copy / paste formatting'], ['Ctrl+wheel', 'Zoom the canvas'], ['Alt+click', 'Pick one object out of a group'], ['Ctrl+A', 'Select all on the layer'],
  ['Delete', 'Delete selection'], ['Arrows', 'Nudge 1 px (Shift: 10 px)'], ['Ctrl+] / Ctrl+[', 'Bring forward / send backward'],
  ['Ctrl+Shift+] / [', 'Bring to front / send to back'], ['Page Up / Page Down', 'Previous / next slide'], ['Escape', 'Clear selection'],
  ['Shift while dragging', 'Constrain move, keep aspect, snap rotation'], ['Double-click', 'Edit text in place'], ['?', 'This list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Keyboard shortcuts">
        <table className="grid">
          <caption>Editor shortcuts (use Cmd on a Mac)</caption>
          <thead><tr><th scope="col">Keys</th><th scope="col">Action</th></tr></thead>
          <tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody>
        </table>
      </div>
    </Dialog>
  );
}

// ---------- find and replace ----------

export function FindReplaceDialog({ onClose }: { onClose: () => void }) {
  const { course, edit, select } = useEditor();
  const { toast } = useUi();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const hits = findTexts(course, find, matchCase);
  return (
    <Dialog title="Find and replace" onClose={onClose} wide={620} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button disabled={!find || hits.length === 0} onClick={() => {
          let n = 0;
          edit('Replace all', (c) => { n = replaceAll(c, find, replace, matchCase); });
          toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'}.`, 'ok');
        }}>Replace all</Button>
      </>
    }>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Find"><input autoFocus value={find} onChange={(e) => setFind(e.target.value)} /></Field>
        <Field label="Replace with"><input value={replace} onChange={(e) => setReplace(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
      <p className="muted text-[13px]" role="status">{find ? `${hits.length} place${hits.length === 1 ? '' : 's'} found` : 'Searches slide titles, text, state text, alt text and accepted answers.'}</p>
      {hits.length > 0 && (
        <ul className="grid gap-1 max-h-64 overflow-auto" aria-label="Matches">
          {hits.slice(0, 200).map((h) => (
            <li key={h.key}>
              <button type="button" className="ghost w-full !h-auto !py-1 !justify-start text-left !whitespace-normal" onClick={() => { if (h.slideId) select({ slideId: h.slideId, objectIds: h.objectId ? [h.objectId] : [] }); }}>
                <span className="grid gap-0.5 font-normal">
                  <span className="text-[11px] text-muted">{h.where} · {h.field}</span>
                  <span className="text-[13px] line-clamp-2">{h.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
