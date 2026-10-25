// Storage per the TechStack: projects in IndexedDB, small settings in localStorage.
// Both can be unavailable (private windows, file:// in some browsers), so every call fails soft.
import { normalizeCourse } from '../model/schema.ts';
import type { Course, ID } from '../model/types.ts';

const DB = 'scrimshaw';
const STORE = 'projects';

export interface ProjectMeta { id: ID; title: string; modified: string; slides: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open storage'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Storage request failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveProject(course: Course): Promise<void> {
  const slides = course.scenes.reduce((n, s) => n + s.slides.length, 0);
  await tx('readwrite', (s) => s.put({ id: course.id, title: course.title, modified: course.modified, slides, course }));
}

export async function loadProject(id: ID): Promise<Course | null> {
  const row = await tx<{ course: unknown } | undefined>('readonly', (s) => s.get(id));
  return row ? normalizeCourse(row.course) : null;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const rows = await tx<{ id: ID; title: string; modified: string; slides: number }[]>('readonly', (s) => s.getAll());
  return rows.map(({ id, title, modified, slides }) => ({ id, title, modified, slides })).sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function deleteProject(id: ID): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

// ---------- settings ----------

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  lastProjectId: ID | null;
  snap: boolean;
  grid: boolean;
  showTimeline: boolean;
  reducedMotion: boolean;
}

const SETTINGS_KEY = 'scrimshaw-settings';
const DEFAULTS: Settings = { theme: 'system', lastProjectId: null, snap: true, grid: false, showTimeline: true, reducedMotion: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Applies the kit's theme contract: data-theme on <html>, or the OS preference for "system". */
export function applyTheme(theme: Settings['theme'], reducedMotion: boolean) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.classList.toggle('light', !dark);
  if (reducedMotion) root.dataset.reducedMotion = 'true';
  else delete root.dataset.reducedMotion;
}
