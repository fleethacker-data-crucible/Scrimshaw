// Fairlead router client for storyboard and quiz drafts (Fleet integrations, issue 14).
// Opt-in: nothing is sent anywhere until the author turns the setting on. Every request goes to ONE loopback
// address, Fairlead on 127.0.0.1:8776, which picks the engine. No key lives in the code, the course file or
// localStorage: the client key is typed per session and held in memory only (the Lazarette hand-off is separate work).
import { baseStyle, newObject, newQuestionSlide, newScene, newSlide, uid } from '../model/factory.ts';
import type { Scene, Slide } from '../model/types.ts';

export const FAIRLEAD_URL = 'http://127.0.0.1:8776';
export const SETTINGS_KEY = 'scrimshaw.router';
export const MAX_SLIDES = 12;
export const MAX_QUESTIONS = 10;

export interface RouterSettings {
  /** Off by default. Drafting needs the author to opt in. */
  enabled: boolean;
  /** Router base address. Loopback only. */
  url: string;
  /** A Fairlead route (auto, smart, fast, local) or alias. */
  model: string;
  /** Send `X-Fairlead-Privacy: local`, so the draft never leaves the machine. On by default. */
  localOnly: boolean;
}

export const defaultRouterSettings = (): RouterSettings => ({ enabled: false, url: FAIRLEAD_URL, model: 'auto', localOnly: true });

/** Only a loopback http address is accepted, so course text can't be pointed at another machine from here. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') && !u.username && !u.password;
  } catch { return false; }
}

export function normalizeRouterSettings(raw: unknown): RouterSettings {
  const d = defaultRouterSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === 'string' && isLoopbackUrl(r.url.trim()) ? r.url.trim().replace(/\/+$/, '') : d.url;
  const model = typeof r.model === 'string' && /^[\w./:-]{1,80}$/.test(r.model.trim()) ? r.model.trim() : d.model;
  return { enabled: r.enabled === true, url, model, localOnly: r.localOnly !== false };
}

interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
const browserStore = (): KeyValueStore | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function loadRouterSettings(store: KeyValueStore | null = browserStore()): RouterSettings {
  try { const raw = store?.getItem(SETTINGS_KEY); return normalizeRouterSettings(raw ? JSON.parse(raw) : null); } catch { return defaultRouterSettings(); }
}
/** Saves only the four settings above. There is no field for a key. */
export function saveRouterSettings(s: RouterSettings, store: KeyValueStore | null = browserStore()): void {
  try { store?.setItem(SETTINGS_KEY, JSON.stringify(normalizeRouterSettings(s))); } catch { /* storage unavailable */ }
}

// ---------- draft shapes ----------

export interface StoryboardDraft { title: string; slides: { title: string; bullets: string[]; notes: string }[] }
export type QuizKind = 'multiple-choice' | 'true-false' | 'fill-in';
export interface QuizQuestionDraft {
  kind: QuizKind;
  question: string;
  /** multiple-choice: the options. Empty for the other kinds. */
  choices: string[];
  /** multiple-choice: index of the right option. true-false: 0 = True, 1 = False. */
  correct: number;
  /** fill-in: accepted answers. */
  accepted: string[];
}
export interface QuizDraft { title: string; questions: QuizQuestionDraft[] }
export type DraftKind = 'storyboard' | 'quiz';

const SYSTEM: Record<DraftKind, string> = {
  storyboard: `You draft e-learning storyboards. Reply with ONLY a JSON object: {"title": string, "slides": [{"title": string, "bullets": [string], "notes": string}]}. At most ${MAX_SLIDES} slides, 2 to 5 short bullets each. Plain words. No markdown.`,
  quiz: `You draft quiz questions. Reply with ONLY a JSON object: {"title": string, "questions": [{"kind": "multiple-choice"|"true-false"|"fill-in", "question": string, "choices": [string], "correct": number, "accepted": [string]}]}. At most ${MAX_QUESTIONS} questions. multiple-choice has 3 to 5 choices and "correct" is the index of the right one. true-false: "correct" is 0 for True, 1 for False. fill-in lists accepted answers. No markdown.`,
};

export class RouterError extends Error {
  readonly code: 'disabled' | 'unreachable' | 'rejected' | 'bad-reply' | 'bad-address';
  constructor(message: string, code: RouterError['code']) { super(message); this.code = code; }
}

export interface RouterCall { settings: RouterSettings; /** Client key, in memory only. */ key?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }

/** Sends one chat request and returns the model's text. */
export async function chat(kind: DraftKind, brief: string, call: RouterCall): Promise<string> {
  const { settings } = call;
  if (!settings.enabled) throw new RouterError('Drafting through the router is off. Turn it on in the draft dialog first.', 'disabled');
  if (!isLoopbackUrl(settings.url)) throw new RouterError('The router address must be on this computer (127.0.0.1 or localhost).', 'bad-address');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Fairlead-Label': 'scrimshaw-drafts' };
  if (settings.localOnly) headers['X-Fairlead-Privacy'] = 'local';
  if (call.key) headers.Authorization = `Bearer ${call.key}`;
  const body = JSON.stringify({
    model: settings.model, stream: false, temperature: 0.4,
    messages: [{ role: 'system', content: SYSTEM[kind] }, { role: 'user', content: brief.slice(0, 8000) }],
  });
  let res: Response;
  try {
    res = await (call.fetchImpl ?? fetch)(`${settings.url.replace(/\/+$/, '')}/v1/chat/completions`, { method: 'POST', headers, body, signal: call.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new RouterError('Could not reach the router. Start Fairlead and check that it allows this page (Fairlead settings, browser origins).', 'unreachable');
  }
  if (!res.ok) throw new RouterError(res.status === 401 || res.status === 403 ? 'The router refused the request. Check the client key.' : `The router answered with status ${res.status}.`, 'rejected');
  let json: unknown;
  try { json = await res.json(); } catch { throw new RouterError('The router sent something that is not JSON.', 'bad-reply'); }
  const text = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new RouterError('The router sent an empty reply.', 'bad-reply');
  return text;
}

// ---------- parsing and validating a reply ----------

/** Pulls the first JSON object out of a reply, tolerating a code fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) throw new RouterError('The reply had no draft in it.', 'bad-reply');
  try { return JSON.parse(src.slice(start, end + 1)); } catch { throw new RouterError('The reply was not valid JSON.', 'bad-reply'); }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strList = (v: unknown, max: number, each: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : []);

export function parseStoryboard(text: string): StoryboardDraft {
  const o = extractJson(text) as { title?: unknown; slides?: unknown };
  const list = (Array.isArray(o?.slides) ? o.slides : []).slice(0, MAX_SLIDES) as Record<string, unknown>[];
  const slides = list.map((s) => ({
    title: str(s?.title, 120), bullets: strList(s?.bullets, 6, 200), notes: typeof s?.notes === 'string' ? s.notes.trim().slice(0, 1000) : '',
  })).filter((s) => s.title);
  if (slides.length === 0) throw new RouterError('The reply had no slides.', 'bad-reply');
  return { title: str(o.title, 120) || 'Drafted course', slides };
}

export function parseQuiz(text: string): QuizDraft {
  const o = extractJson(text) as { title?: unknown; questions?: unknown };
  const out: QuizQuestionDraft[] = [];
  for (const q of (Array.isArray(o?.questions) ? o.questions : []).slice(0, MAX_QUESTIONS) as Record<string, unknown>[]) {
    const kind = q?.kind;
    const question = str(q?.question, 300);
    if (!question || (kind !== 'multiple-choice' && kind !== 'true-false' && kind !== 'fill-in')) continue;
    const choices = strList(q.choices, 5, 160);
    const correct = typeof q.correct === 'number' && Number.isInteger(q.correct) ? q.correct : -1;
    const accepted = strList(q.accepted, 6, 80);
    if (kind === 'multiple-choice' && (choices.length < 2 || correct < 0 || correct >= choices.length)) continue;
    if (kind === 'true-false' && correct !== 0 && correct !== 1) continue;
    if (kind === 'fill-in' && accepted.length === 0) continue;
    out.push({ kind, question, choices: kind === 'multiple-choice' ? choices : [], correct: kind === 'fill-in' ? 0 : correct, accepted: kind === 'fill-in' ? accepted : [] });
  }
  if (out.length === 0) throw new RouterError('The reply had no usable questions.', 'bad-reply');
  return { title: str(o.title, 120) || 'Drafted quiz', questions: out };
}

// ---------- turning a draft into course content ----------

export function storyboardToScene(d: StoryboardDraft): Scene {
  const slides = d.slides.map((s): Slide => {
    const slide = newSlide(s.title);
    const base = slide.layers[0];
    base.objects.push(newObject('text', { name: 'Title', x: 60, y: 40, w: 840, h: 80, text: s.title, style: baseStyle({ fontSize: 34, fontWeight: 700 }) }));
    if (s.bullets.length) {
      base.objects.push(newObject('text', { name: 'Body', x: 60, y: 140, w: 840, h: 340, text: s.bullets.map((b) => `- ${b}`).join('\n'), style: baseStyle({ fontSize: 22 }) }));
    }
    slide.notes = s.notes;
    return slide;
  });
  return newScene(d.title, slides);
}

export function quizToSlides(d: QuizDraft): Slide[] {
  return d.questions.map((q) => {
    const slide = newQuestionSlide(q.kind);
    const base = slide.layers[0];
    slide.title = q.question.slice(0, 60);
    const prompt = base.objects.find((o) => o.name === 'Question');
    if (prompt) prompt.text = q.question;
    if (q.kind === 'fill-in') { slide.question!.accepted = [...q.accepted]; return slide; }
    const choices = base.objects.filter((o) => o.kind === 'choice');
    if (q.kind === 'multiple-choice') {
      // The template has four options; drop or add so the slide matches the draft.
      while (choices.length > q.choices.length) base.objects.splice(base.objects.indexOf(choices.pop()!), 1);
      while (choices.length < q.choices.length) {
        const extra = { ...structuredClone(choices[0]), id: uid('o'), name: `Choice ${choices.length + 1}` };
        base.objects.splice(base.objects.indexOf(choices[choices.length - 1]) + 1, 0, extra);
        choices.push(extra);
      }
      choices.forEach((o, i) => { o.text = q.choices[i]; o.correct = i === q.correct; o.y = 150 + i * 60; });
    } else {
      choices.forEach((o, i) => { o.correct = i === q.correct; });
    }
    return slide;
  });
}
