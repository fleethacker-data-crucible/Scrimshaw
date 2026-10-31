import { useCallback, useEffect, useRef, useState } from 'react';
import { newCourse, newObject, sampleCourse, newSlide } from '../model/factory.ts';
import { allSlides, findLayer, findSlide } from '../model/query.ts';
import { parseCourse, serializeCourse } from '../model/schema.ts';
import type { Asset, Course, ID, ObjectKind, ShapeKind, SlideObject } from '../model/types.ts';
import { download, fileName } from '../export/publish.ts';
import { Player } from '../player/Player.tsx';
import { redoLabel, undoLabel } from '../store/history.ts';
import { align, copyObjects, deleteObjects, distribute, insertSlideAfter, reorder, type Align, type ZOrder } from '../store/ops.ts';
import { applyTheme, loadProject, loadSettings, saveProject, saveSettings, type Settings } from '../store/persist.ts';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  BringToFront, ChevronDown, Circle, Copy, FileBraces, FolderOpen, Grid3x3, Image, Keyboard, Magnet, MonitorPlay, MousePointerClick, Moon,
  Package, Play, Redo2, Save, Scan, SendToBack, Settings as SettingsIcon, Square, SquareCheck, SquareDashed, Sun, TextCursorInput, Trash, Type, Undo2,
  Variable, Video, Volume2, Gauge, Workflow, ZoomIn, ZoomOut, Clock,
} from '../ui/icons.tsx';
import { Button, IconButton, Menu, useUi, type MenuItem } from '../ui/kit.tsx';
import { fileToAsset, imageSize, pickFile, pickFiles, withAsset } from './assets.ts';
import { applyImport, planImport } from '../import/media.ts';
import { Canvas } from './Canvas.tsx';
import { EditorProvider, useEditor } from './context.tsx';
import { CourseDialog, FindReplaceDialog, ProjectsDialog, PublishDialog, ShortcutsDialog, VariablesDialog } from './Dialogs.tsx';
import { applyTexts, csvToTexts, textsToCsv } from '../model/texts.ts';
import { buildStoryboard, currentCss } from '../export/storyboard.tsx';
import { Inspector } from './Inspector.tsx';
import { LayersPanel } from './LayersPanel.tsx';
import emblem from '../assets/emblem.webp';
import { Welcome, markWelcomeSeen, welcomeSeen } from './Welcome.tsx';
import { SlidePanel, useNewSlideItems } from './SlidePanel.tsx';
import { StoryView } from './StoryView.tsx';
import { Timeline } from './Timeline.tsx';

/** Ribbon button: label collapses to the icon on narrow screens, keeping the accessible name. */
function RB({ icon, label, onClick, title }: { icon: React.ReactNode; label: string; onClick: () => void; title?: string }) {
  return <Button size="small" variant="ghost" onClick={onClick} title={title ?? label} aria-label={label}>{icon}<span className="lbl">{label}</span></Button>;
}

/** In-memory clipboard. Carries the media its objects use so pasting into another project works. */
let clipboard: { objects: SlideObject[]; assets: Asset[] } | null = null;
/** Format painter: the style (and shape) copied with Ctrl+Alt+C. */
let styleClip: { style: SlideObject['style']; shape: SlideObject['shape'] } | null = null;

// Keys typed into a field, or used to move around an open menu, are not editor shortcuts.
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input,textarea,select,[contenteditable=true],[role=menu],[role=menubar]');

export function EditorRoot() {
  const [course, setCourse] = useState<Course | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const { toast } = useUi();
  useEffect(() => { applyTheme(settings.theme, settings.reducedMotion); saveSettings(settings); }, [settings]);
  useEffect(() => {
    if (settings.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system', settings.reducedMotion);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings.theme, settings.reducedMotion]);
  useEffect(() => {
    let alive = true;
    (async () => {
      let c: Course | null = null;
      if (settings.lastProjectId) {
        try { c = await loadProject(settings.lastProjectId); } catch (e) { toast(`Could not open your last project: ${(e as Error).message}`, 'warn'); }
      }
      if (alive) setCourse(c ?? sampleCourse());
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback((c: Course) => {
    setCourse(c);
    setSettings((s) => ({ ...s, lastProjectId: c.id }));
  }, []);
  if (!course) return <div className="grid place-items-center h-full muted" role="status">Opening Scrimshaw…</div>;
  return (
    <EditorProvider key={course.id} initial={course}>
      <EditorShell settings={settings} setSettings={setSettings} openCourse={open} />
    </EditorProvider>
  );
}

type DialogName = 'variables' | 'course' | 'projects' | 'publish' | 'shortcuts' | 'find' | null;

function EditorShell({ settings, setSettings, openCourse }: { settings: Settings; setSettings: (fn: (s: Settings) => Settings) => void; openCourse: (c: Course) => void }) {
  const ed = useEditor();
  const { course, state, slide, layer, selected, edit, select, dispatch } = ed;
  const { toast, confirm } = useUi();
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [resolvedZoom, setResolvedZoom] = useState(1);
  const [story, setStory] = useState(false);
  const [preview, setPreview] = useState<{ from: ID | null } | null>(null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [previewStates, setPreviewStates] = useState<Record<ID, string>>({});
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'full' | 'unsaved'>('saved');
  const [welcome, setWelcome] = useState(() => !welcomeSeen());
  const warnedFull = useRef(false);
  const newSlideItems = useNewSlideItems(() => state.sel.slideId);

  // ---- autosave to IndexedDB ----
  const latest = useRef(course);
  latest.current = course;
  // A status message is not proof that the current revision reached durable storage.
  const persisted = useRef<Course | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRequest = useRef(0);
  const saveNow = useCallback(async () => {
    const snapshot = latest.current;
    const request = ++saveRequest.current;
    setSaveStatus('saving');
    // Keep overlapping autosave/manual writes ordered so an older save cannot overwrite a newer one.
    const operation = saveQueue.current.then(() => saveProject(snapshot));
    saveQueue.current = operation.catch(() => {});
    try {
      await operation;
      persisted.current = snapshot;
      if (request === saveRequest.current) setSaveStatus(latest.current === snapshot ? 'saved' : 'unsaved');
      return latest.current === persisted.current;
    }
    catch (e) {
      const full = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (request === saveRequest.current) setSaveStatus(full ? 'full' : 'error');
      if (full && !warnedFull.current) {
        warnedFull.current = true;
        toast('Browser storage is full, so changes are not being saved here. Use File › Save to file now, then remove unused media or old projects.', 'err');
      }
      return false;
    }
  }, []);
  useEffect(() => {
    if (state.revision === 0) { void saveNow(); setSettings((s) => (s.lastProjectId === course.id ? s : { ...s, lastProjectId: course.id })); return; }
    setSaveStatus('unsaved');
    const t = setTimeout(() => void saveNow(), 800);
    return () => clearTimeout(t);
  }, [state.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (latest.current !== persisted.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // ---- inserting ----
  const insert = useCallback((kind: ObjectKind, over: Partial<SlideObject> = {}) => {
    edit(`Insert ${kind}`, (c, sel) => {
      const l = findLayer(findSlide(c, sel.slideId)!, sel.layerId)!;
      const o = newObject(kind, over);
      o.x = over.x ?? Math.round((c.size.w - o.w) / 2);
      o.y = over.y ?? Math.round((c.size.h - o.h) / 2);
      const names = new Set(l.objects.map((x) => x.name));
      if (names.has(o.name)) { let i = 2; while (names.has(`${o.name} ${i}`)) i++; o.name = `${o.name} ${i}`; }
      l.objects.push(o);
      return { objectIds: [o.id] };
    });
  }, [edit]);
  const insertMedia = async (kind: 'image' | 'video' | 'audio') => {
    const f = await pickFile(`${kind}/*`);
    if (!f) return;
    try {
      const a = await fileToAsset(f, kind);
      const size = kind === 'image' ? await imageSize(a.data, course.size.w * 0.8, course.size.h * 0.8) : kind === 'audio' ? { w: 48, h: 48 } : { w: 480, h: 270 };
      edit(`Insert ${kind}`, (c, sel) => {
        withAsset(c, a);
        const l = findLayer(findSlide(c, sel.slideId)!, sel.layerId)!;
        const o = newObject(kind, { src: `asset:${a.id}`, w: size.w, h: size.h, alt: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) });
        o.x = Math.round((c.size.w - o.w) / 2);
        o.y = Math.round((c.size.h - o.h) / 2);
        l.objects.push(o);
        return { objectIds: [o.id] };
      });
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const insertShape = (shape: ShapeKind, name: string) => insert('shape', { shape, name, ...(shape === 'line' ? { h: 8, style: { ...newObject('shape').style, stroke: '#1a1a19', strokeWidth: 3, fill: 'transparent' } } : {}) });

  // ---- clipboard and arrange ----
  const copy = useCallback(() => {
    if (selected.length === 0) return false;
    const assets = selected.filter((o) => o.src.startsWith('asset:')).map((o) => course.assets[o.src.slice(6)]).filter(Boolean);
    clipboard = { objects: structuredClone(selected), assets };
    return true;
  }, [selected, course.assets]);
  const paste = useCallback(() => {
    const clip = clipboard;
    if (!clip) return;
    edit('Paste', (c, sel) => {
      for (const a of clip.assets) if (!c.assets[a.id]) withAsset(c, a);
      const l = findLayer(findSlide(c, sel.slideId)!, sel.layerId)!;
      const copies = copyObjects(clip.objects).map((o) => ({ ...o, x: o.x + 16, y: o.y + 16 }));
      l.objects.push(...copies);
      clipboard = { ...clip, objects: copies.map((o) => structuredClone(o)) };
      return { objectIds: copies.map((o) => o.id) };
    });
  }, [edit]);
  const duplicate = useCallback(() => {
    if (selected.length === 0) return;
    const ids = selected.map((o) => o.id);
    edit('Duplicate', (c, sel) => {
      const l = findLayer(findSlide(c, sel.slideId)!, sel.layerId)!;
      const copies = copyObjects(l.objects.filter((o) => ids.includes(o.id))).map((o) => ({ ...o, x: o.x + 16, y: o.y + 16, name: `${o.name} copy` }));
      l.objects.push(...copies);
      return { objectIds: copies.map((o) => o.id) };
    });
  }, [selected, edit]);
  const remove = useCallback(() => {
    if (selected.length === 0) return;
    const ids = selected.map((o) => o.id);
    edit(ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete object', (c, sel) => { deleteObjects(findSlide(c, sel.slideId)!, ids); return { objectIds: [] }; });
  }, [selected, edit]);
  const copyStyle = () => {
    if (selected.length !== 1) { toast('Select one object to copy its formatting.', 'warn'); return; }
    styleClip = { style: structuredClone(selected[0].style), shape: selected[0].shape };
    toast(`Copied the formatting of ${selected[0].name}.`, 'ok');
  };
  const pasteStyle = () => {
    const clip = styleClip;
    if (!clip || selected.length === 0) return;
    ed.editSelected('Paste formatting', (o) => { o.style = structuredClone(clip.style); if (o.kind === 'shape') o.shape = clip.shape; });
  };
  const groupable = selected.length >= 2;
  const grouped = selected.some((o) => o.groupId);
  const group = () => {
    if (!groupable) return;
    const ids = selected.map((o) => o.id);
    edit('Group', (c, sel) => { const g = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; for (const o of findLayer(findSlide(c, sel.slideId)!, sel.layerId)!.objects) if (ids.includes(o.id)) o.groupId = g; });
  };
  const ungroup = () => {
    if (!grouped) return;
    const ids = selected.map((o) => o.id);
    edit('Ungroup', (c, sel) => { for (const o of findLayer(findSlide(c, sel.slideId)!, sel.layerId)!.objects) if (ids.includes(o.id)) o.groupId = null; });
  };
  const arrange = (how: ZOrder) => edit('Arrange', (c, sel) => reorder(findLayer(findSlide(c, sel.slideId)!, sel.layerId)!, sel.objectIds, how));
  const doAlign = (how: Align) => edit('Align', (c, sel) => align(findLayer(findSlide(c, sel.slideId)!, sel.layerId)!.objects.filter((o) => sel.objectIds.includes(o.id)), how, c.size));
  const doDistribute = (axis: 'h' | 'v') => edit('Distribute', (c, sel) => distribute(findLayer(findSlide(c, sel.slideId)!, sel.layerId)!.objects.filter((o) => sel.objectIds.includes(o.id)), axis));

  // ---- files ----
  const saveToFile = () => download(fileName(course.title, 'scrim'), serializeCourse(course), 'application/json');
  const saveBeforeLeaving = async () => (await saveNow()) || await confirm({
    title: 'Leave this unsaved course?',
    message: 'The current course could not be saved in this browser. Cancel and use Save to file to keep a copy before opening another course.',
    ok: 'Leave without saving', danger: true,
  });
  const importFile = async () => {
    const f = await pickFile('.scrim,.json,application/json');
    if (!f) return;
    try {
      const c = parseCourse(await f.text());
      if (!(await saveBeforeLeaving())) return;
      await saveProject(c).catch(() => {});
      setDialog(null);
      openCourse(c);
      toast(`Opened “${c.title}”.`, 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const importTranslation = async () => {
    const f = await pickFile('.csv,text/csv');
    if (!f) return;
    try {
      const values = csvToTexts(await f.text());
      // Count on a copy first: the reducer applies the edit later, during React's next render.
      const n = applyTexts(structuredClone(course), values);
      edit('Import translation', (c) => { applyTexts(c, values); });
      toast(n ? `Updated ${n} text${n === 1 ? '' : 's'} from the translation. Undo reverts it.` : 'No translated rows matched this course.', n ? 'ok' : 'warn');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const importFleetMedia = async () => {
    const picked = await pickFiles('.mp4,.m4v,.webm,.vtt,.txt,.png,.json,.wav');
    if (!picked.length) return;
    try {
      const plan = planImport(await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      const n = plan.videos.length + plan.images.length + plan.audio.length;
      if (n) { edit('Import Fleet media', (c) => { applyImport(c, plan); }); }
      const skipped = plan.rejected.length + plan.warnings.length;
      const detail = [...plan.rejected.map((r) => r.reason), ...plan.warnings].slice(0, 3).join(' ');
      toast(n ? `Added ${n} slide${n === 1 ? '' : 's'} in a new scene "Imported media".${skipped ? ` ${skipped} file${skipped === 1 ? '' : 's'} skipped or adjusted. ${detail}` : ''} Undo reverts it.` : `Nothing imported. ${detail}`, n ? (skipped ? 'warn' : 'ok') : 'err');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const openNew = async (c: Course) => { if (!(await saveBeforeLeaving())) return; await saveProject(c).catch(() => {}); setDialog(null); openCourse(c); };

  // ---- keyboard ----
  const slides = allSlides(course);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (preview) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (mod && k.toLowerCase() === 's') { e.preventDefault(); void saveNow().then((saved) => { if (saved) toast('Saved in this browser.', 'ok'); }); return; }
      if (document.querySelector('dialog[open]')) return;
      if (k === 'F5') { e.preventDefault(); setPreview({ from: e.shiftKey || state.sel.slideId === course.master.id ? null : state.sel.slideId }); return; }
      if (isTyping(e.target)) return;
      if (mod && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); return; }
      if (mod && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'redo' }); return; }
      if (mod && k.toLowerCase() === 'm') { e.preventDefault(); edit('New slide', (c, sel) => { const s = insertSlideAfter(c, sel.slideId, newSlide()); return { slideId: s.id, layerId: s.layers[0].id, objectIds: [] }; }); return; }
      if (k === 'PageDown' || k === 'PageUp') {
        const i = slides.findIndex((s) => s.id === state.sel.slideId);
        const n = slides[i + (k === 'PageDown' ? 1 : -1)];
        if (n) { e.preventDefault(); select({ slideId: n.id, objectIds: [] }); }
        return;
      }
      if (k === '?') { setDialog('shortcuts'); return; }
      if (mod && k.toLowerCase() === 'h') { e.preventDefault(); setDialog('find'); return; }
      if (story) return;
      if (mod && k.toLowerCase() === 'a') { e.preventDefault(); select({ objectIds: layer.objects.filter((o) => !o.locked && !o.editorHidden).map((o) => o.id) }); return; }
      if (mod && e.altKey && k.toLowerCase() === 'c') { e.preventDefault(); copyStyle(); return; }
      if (mod && e.altKey && k.toLowerCase() === 'v') { e.preventDefault(); pasteStyle(); return; }
      if (mod && k.toLowerCase() === 'c') { if (copy()) e.preventDefault(); return; }
      if (mod && k.toLowerCase() === 'x') { if (copy()) { e.preventDefault(); remove(); } return; }
      if (mod && k.toLowerCase() === 'v') { if (clipboard) { e.preventDefault(); paste(); } return; }
      if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && k.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return; }
      if (mod && (k === ']' || k === '[')) { e.preventDefault(); arrange(k === ']' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward')); return; }
      if (k === 'Delete' || k === 'Backspace') { if (selected.length) { e.preventDefault(); remove(); } return; }
      if (k === 'Escape') { select({ objectIds: [] }); return; }
      if (k.startsWith('Arrow') && selected.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
        const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
        ed.editSelected('Nudge', (o) => { if (!o.locked) { o.x += dx; o.y += dy; } }, 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const contextItems = (): MenuItem[] => {
    const has = selected.length > 0;
    return [
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !has, onSelect: () => { if (copy()) remove(); } },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !has, onSelect: () => { copy(); } },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard, onSelect: paste },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: !has, onSelect: duplicate },
      { separator: true, label: '' },
      { label: 'Bring to front', shortcut: 'Ctrl+Shift+]', disabled: !has, onSelect: () => arrange('front') },
      { label: 'Bring forward', shortcut: 'Ctrl+]', disabled: !has, onSelect: () => arrange('forward') },
      { label: 'Send backward', shortcut: 'Ctrl+[', disabled: !has, onSelect: () => arrange('backward') },
      { label: 'Send to back', shortcut: 'Ctrl+Shift+[', disabled: !has, onSelect: () => arrange('back') },
      { separator: true, label: '' },
      { label: 'Group', shortcut: 'Ctrl+G', disabled: !groupable, onSelect: group },
      { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !grouped, onSelect: ungroup },
      { label: 'Copy formatting', shortcut: 'Ctrl+Alt+C', disabled: selected.length !== 1, onSelect: copyStyle },
      { label: 'Paste formatting', shortcut: 'Ctrl+Alt+V', disabled: !has || !styleClip, onSelect: pasteStyle },
      { separator: true, label: '' },
      { label: selected.length > 1 ? `Delete ${selected.length} objects` : 'Delete', shortcut: 'Del', danger: true, disabled: !has, onSelect: remove },
    ];
  };
  const setPreviewState = (id: ID, st: string | null) => setPreviewStates((p) => { const n = { ...p }; if (st) n[id] = st; else delete n[id]; return n; });
  const toggle = (k: 'snap' | 'grid' | 'showTimeline') => setSettings((s) => ({ ...s, [k]: !s[k] }));
  const dark = document.documentElement.dataset.theme !== 'light';
  const undo = undoLabel(state);
  const redo = redoLabel(state);
  const statusText = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved: browser storage unavailable. Use File › Save to file', full: 'Not saved: browser storage is full. Use File › Save to file' }[saveStatus];
  const multi = selected.length > 1;
  const leaveWelcome = (then?: () => void) => { markWelcomeSeen(); setWelcome(false); then?.(); };

  if (welcome) {
    return (
      <Welcome
        courseTitle={course.title}
        onContinue={() => leaveWelcome()}
        onNew={() => leaveWelcome(() => { void openNew(newCourse()); })}
        onProjects={() => leaveWelcome(() => setDialog('projects'))}
        onOpenFile={() => leaveWelcome(() => { void importFile(); })}
      />
    );
  }

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to canvas</a>
      <header className="topbar">
        <span className="brand"><img className="logo" src={emblem} alt="" width={40} height={40} /><span><h1>Scrimshaw</h1><span className="sub">{course.title || 'Untitled'} · <span role="status" className={saveStatus === 'error' || saveStatus === 'full' ? 'err' : undefined}>{statusText}</span></span></span></span>
        <Menu label="File" items={[
          { label: 'Projects…', icon: <FolderOpen />, onSelect: () => setDialog('projects') },
          { label: 'New course', onSelect: () => openNew(newCourse()) },
          { label: 'Open a .scrim file…', icon: <FileBraces />, onSelect: importFile },
          { separator: true, label: '' },
          { label: 'Save now', icon: <Save />, shortcut: 'Ctrl+S', onSelect: () => { void saveNow(); } },
          { label: 'Save to file (.scrim)', onSelect: saveToFile },
          { separator: true, label: '' },
          { label: 'Course settings…', icon: <SettingsIcon />, onSelect: () => setDialog('course') },
          { separator: true, label: '' },
          { label: 'Find and replace…', shortcut: 'Ctrl+H', onSelect: () => setDialog('find') },
          { label: 'Storyboard for review (printable HTML)', onSelect: () => download(fileName(course.title, 'storyboard.html'), buildStoryboard(course, currentCss(document)), 'text/html') },
          { label: 'Export text for translation (.csv)', onSelect: () => download(fileName(course.title, 'translation.csv'), textsToCsv(course), 'text/csv') },
          { label: 'Import translated text (.csv)…', onSelect: importTranslation },
          { label: 'Import Fleet media (video, captions, PNG, WAV)…', onSelect: importFleetMedia },
        ]}>File<ChevronDown size={14} /></Menu>
        {(saveStatus === 'error' || saveStatus === 'full') && <Button onClick={saveToFile}>Save to file</Button>}
        <span className="spacer" />
        <IconButton label={undo ? `Undo ${undo} (Ctrl+Z)` : 'Nothing to undo'} disabled={!undo} onClick={() => dispatch({ type: 'undo' })}><Undo2 /></IconButton>
        <IconButton label={redo ? `Redo ${redo} (Ctrl+Y)` : 'Nothing to redo'} disabled={!redo} onClick={() => dispatch({ type: 'redo' })}><Redo2 /></IconButton>
        <IconButton label={story ? 'Back to slide view' : 'Story view'} pressed={story} onClick={() => setStory((s) => !s)}><Workflow /></IconButton>
        <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setSettings((s) => ({ ...s, theme: dark ? 'light' : 'dark' }))}>{dark ? <Sun /> : <Moon />}</IconButton>
        <IconButton label="Keyboard shortcuts (?)" onClick={() => setDialog('shortcuts')}><Keyboard /></IconButton>
        <Menu label="Preview" variant="ghost" align="right" items={[
          { label: 'This slide', icon: <Play />, shortcut: 'F5', onSelect: () => setPreview({ from: state.sel.slideId === course.master.id ? null : state.sel.slideId }) },
          { label: 'From the beginning', icon: <MonitorPlay />, shortcut: 'Shift+F5', onSelect: () => setPreview({ from: null }) },
        ]}><Play />Preview<ChevronDown size={14} /></Menu>
        <Button variant="primary" onClick={() => setDialog('publish')}><Package />Publish</Button>
      </header>

      <div className="ribbon" role="toolbar" aria-label="Insert and arrange">
        <span className="ribbon-label lbl">Insert</span>
        <Menu label="New slide" items={newSlideItems} size="small" title="New slide (Ctrl+M)">Slide<ChevronDown size={12} /></Menu>
        <RB icon={<Type size={14} />} label="Text" title="Text box" onClick={() => insert('text')} />
        <Menu label="Shape" title="Shape" size="small" items={[
          { label: 'Rectangle', icon: <Square />, onSelect: () => insertShape('rect', 'Rectangle') },
          { label: 'Rounded rectangle', icon: <Square />, onSelect: () => insertShape('round', 'Rounded rectangle') },
          { label: 'Oval', icon: <Circle />, onSelect: () => insertShape('ellipse', 'Oval') },
          { label: 'Triangle', onSelect: () => insertShape('triangle', 'Triangle') },
          { label: 'Arrow', onSelect: () => insertShape('arrow', 'Arrow') },
          { label: 'Line', onSelect: () => insertShape('line', 'Line') },
        ]}><Square size={14} /><span className="lbl">Shape</span><ChevronDown size={12} /></Menu>
        <RB icon={<Image size={14} />} label="Image" onClick={() => insertMedia('image')} />
        <RB icon={<Video size={14} />} label="Video" onClick={() => insertMedia('video')} />
        <RB icon={<Volume2 size={14} />} label="Audio" onClick={() => insertMedia('audio')} />
        <RB icon={<MousePointerClick size={14} />} label="Button" onClick={() => insert('button')} />
        <RB icon={<SquareDashed size={14} />} label="Hotspot" onClick={() => insert('hotspot')} />
        <RB icon={<TextCursorInput size={14} />} label="Text entry" onClick={() => insert('input')} />
        <RB icon={<SquareCheck size={14} />} label="Choice" onClick={() => insert('choice')} />
        <RB icon={<Gauge size={14} />} label="Slider" onClick={() => insert('slider')} />
        <span className="sep" />
        <span className="ribbon-label lbl">Arrange</span>
        <Menu label="Align" size="small" items={[
          { label: multi ? 'Align left' : 'Align to slide left', icon: <AlignStartVertical />, onSelect: () => doAlign('left') },
          { label: multi ? 'Align centre' : 'Centre on slide', icon: <AlignCenterVertical />, onSelect: () => doAlign('hcenter') },
          { label: multi ? 'Align right' : 'Align to slide right', icon: <AlignEndVertical />, onSelect: () => doAlign('right') },
          { separator: true, label: '' },
          { label: multi ? 'Align top' : 'Align to slide top', icon: <AlignStartHorizontal />, onSelect: () => doAlign('top') },
          { label: multi ? 'Align middle' : 'Middle of slide', icon: <AlignCenterHorizontal />, onSelect: () => doAlign('vmiddle') },
          { label: multi ? 'Align bottom' : 'Align to slide bottom', icon: <AlignEndHorizontal />, onSelect: () => doAlign('bottom') },
          { separator: true, label: '' },
          { label: 'Distribute horizontally', disabled: selected.length < 3, onSelect: () => doDistribute('h') },
          { label: 'Distribute vertically', disabled: selected.length < 3, onSelect: () => doDistribute('v') },
          { separator: true, label: '' },
          { label: 'Copy formatting', shortcut: 'Ctrl+Alt+C', disabled: selected.length !== 1, onSelect: copyStyle },
          { label: 'Paste formatting', shortcut: 'Ctrl+Alt+V', disabled: selected.length === 0, onSelect: pasteStyle },
          { separator: true, label: '' },
          { label: 'Group', shortcut: 'Ctrl+G', disabled: !groupable, onSelect: group },
          { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !grouped, onSelect: ungroup },
        ].map((i) => ({ ...i, disabled: i.disabled || selected.length === 0 }))}>Align<ChevronDown size={12} /></Menu>
        <IconButton label="Bring to front (Ctrl+Shift+])" disabled={!selected.length} onClick={() => arrange('front')}><BringToFront /></IconButton>
        <IconButton label="Send to back (Ctrl+Shift+[)" disabled={!selected.length} onClick={() => arrange('back')}><SendToBack /></IconButton>
        <IconButton label="Duplicate (Ctrl+D)" disabled={!selected.length} onClick={duplicate}><Copy /></IconButton>
        <Menu label="Move to layer" size="small" items={slide.layers.filter((l) => l.id !== layer.id).map((l) => ({
          label: l.name, onSelect: () => { const ids = state.sel.objectIds; edit('Move to layer', (c, sel) => { const s = findSlide(c, sel.slideId)!; const to = findLayer(s, l.id)!; for (const x of s.layers) { const moving = x.objects.filter((o) => ids.includes(o.id)); x.objects = x.objects.filter((o) => !ids.includes(o.id)); to.objects.push(...moving); } return { layerId: l.id, objectIds: ids }; }); },
        }))}>Layer<ChevronDown size={12} /></Menu>
        <IconButton label="Delete (Del)" disabled={!selected.length} onClick={remove}><Trash /></IconButton>
        <span className="sep" />
        <Button size="small" variant="ghost" aria-label={`Variables (${course.variables.length})`} title="Variables" onClick={() => setDialog('variables')}><Variable size={14} /><span className="lbl">Variables</span>{course.variables.length > 0 && <span className="badge grey !h-4">{course.variables.length}</span>}</Button>
        <span className="spacer flex-1" />
        <IconButton label="Snap to guides" pressed={settings.snap} onClick={() => toggle('snap')}><Magnet /></IconButton>
        <IconButton label="Show grid" pressed={settings.grid} onClick={() => toggle('grid')}><Grid3x3 /></IconButton>
        <IconButton label="Zoom out" onClick={() => setZoom(Math.max(0.25, Math.round((resolvedZoom - 0.1) * 10) / 10))}><ZoomOut /></IconButton>
        <span className="text-[12px] tabular-nums w-10 text-center" aria-live="polite" aria-label="Zoom level">{Math.round(resolvedZoom * 100)}%</span>
        <IconButton label="Zoom in" onClick={() => setZoom(Math.min(3, Math.round((resolvedZoom + 0.1) * 10) / 10))}><ZoomIn /></IconButton>
        <IconButton label="Fit to window" pressed={zoom === 'fit'} onClick={() => setZoom('fit')}><Scan /></IconButton>
        <IconButton label={settings.showTimeline ? 'Hide timeline and layers' : 'Show timeline and layers'} pressed={settings.showTimeline} onClick={() => toggle('showTimeline')}><Clock /></IconButton>
      </div>

      <div className="workspace">
        <SlidePanel />
        <div className="center" style={settings.showTimeline && !story ? undefined : { gridTemplateRows: 'minmax(0,1fr)' }}>
          <main id="main" tabIndex={-1} className="relative min-h-0 grid">
            {story
              ? <StoryView onOpen={() => setStory(false)} />
              : <Canvas contextItems={contextItems} zoom={zoom} onZoom={setZoom} onZoomResolved={setResolvedZoom} snap={settings.snap} grid={settings.grid} previewStates={previewStates} />}
          </main>
          {settings.showTimeline && !story && (
            <div className="bottom">
              <Timeline />
              <LayersPanel />
            </div>
          )}
        </div>
        <Inspector previewStates={previewStates} setPreviewState={setPreviewState} />
      </div>

      {dialog === 'variables' && <VariablesDialog onClose={() => setDialog(null)} />}
      {dialog === 'course' && <CourseDialog onClose={() => setDialog(null)} />}
      {dialog === 'publish' && <PublishDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'find' && <FindReplaceDialog onClose={() => setDialog(null)} />}
      {dialog === 'projects' && (
        <ProjectsDialog currentId={course.id} onClose={() => setDialog(null)} onImport={importFile}
          onOpen={async (id) => {
            if (!(await saveBeforeLeaving())) return;
            try { const c = await loadProject(id); if (c) { setDialog(null); openCourse(c); } } catch (e) { toast((e as Error).message, 'err'); }
          }}
          onNew={() => openNew(newCourse())}
          onSample={async () => {
            if (!(await confirm({ title: 'Open the sample course?', message: 'A fresh copy of the sample course opens as a new project. Your current project stays saved.', ok: 'Open sample' }))) return;
            void openNew(sampleCourse());
          }} />
      )}
      {preview && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Preview">
          <Player course={course} embedded startAt={preview.from} onClose={() => setPreview(null)} />
        </div>
      )}
    </div>
  );
}
