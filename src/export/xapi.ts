// xAPI (Tin Can) publishing and runtime. An LRS-backed LMS launches the package with the
// standard Tin Can launch parameters (endpoint, auth, actor, registration, activity_id).
// The player sends statements for the attempt, each answered question and the result, and keeps
// resume data in the xAPI State API.
import type { Course } from '../model/types.ts';
import { escapeXml } from './scorm.ts';
import type { Lms } from './scorm.ts';

export const XAPI_VERSION = '1.0.3';
const VERB = (id: string, en: string) => ({ id: `http://adlnet.gov/expapi/verbs/${id}`, display: { 'en-US': en } });
export const VERBS = {
  initialized: VERB('initialized', 'initialized'),
  answered: VERB('answered', 'answered'),
  passed: VERB('passed', 'passed'),
  failed: VERB('failed', 'failed'),
  completed: VERB('completed', 'completed'),
  terminated: VERB('terminated', 'terminated'),
  suspended: VERB('suspended', 'suspended'),
};

export function activityId(course: Course): string {
  return `urn:scrimshaw:course:${course.id}`;
}

export function tincanXml(course: Course): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${escapeXml(activityId(course))}" type="http://adlnet.gov/expapi/activities/course">
      <name>${escapeXml(course.title || 'Untitled course')}</name>
      <description lang="en-US">${escapeXml(course.description || course.title || '')}</description>
      <launch lang="en-US">index.html</launch>
    </activity>
  </activities>
</tincan>
`;
}

export interface Launch {
  endpoint: string;
  auth: string;
  actor: Record<string, unknown>;
  registration: string | null;
  activityId: string;
}

/** Reads Tin Can launch parameters. Only http(s) endpoints are accepted. */
export function parseLaunch(search: string, fallbackActivity: string): Launch | null {
  const q = new URLSearchParams(search);
  const endpoint = q.get('endpoint');
  const actorRaw = q.get('actor');
  if (!endpoint || !actorRaw) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let actor: Record<string, unknown>;
  try {
    const a = JSON.parse(actorRaw) as Record<string, unknown>;
    // Tin Can launches sometimes send name/mbox/account as one-element arrays.
    actor = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    actor.objectType = 'Agent';
  } catch { return null; }
  return {
    endpoint: url.href.endsWith('/') ? url.href : `${url.href}/`,
    auth: q.get('auth') ?? '',
    actor,
    registration: q.get('registration'),
    activityId: q.get('activity_id') || fallbackActivity,
  };
}

export interface XapiTransport {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; keepalive?: boolean }): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface XapiLms extends Lms {
  answered(question: { id: string; title: string; correct: boolean; response: string; points: number; max: number }): void;
}

/** Connects to the LRS named in the launch URL. Resolves to null when this is not an xAPI launch. */
export async function connectXapi(course: Course, search: string, transport: XapiTransport, now: () => number = Date.now): Promise<XapiLms | null> {
  const launch = parseLaunch(search, activityId(course));
  if (!launch) return null;
  const headers = { 'Content-Type': 'application/json', 'X-Experience-API-Version': XAPI_VERSION, ...(launch.auth ? { Authorization: launch.auth } : {}) };
  const object = { objectType: 'Activity', id: launch.activityId, definition: { name: { 'en-US': course.title }, type: 'http://adlnet.gov/expapi/activities/course' } };
  const context = launch.registration ? { registration: launch.registration } : undefined;
  const started = now();
  const send = (verb: { id: string }, extra: Record<string, unknown> = {}, keepalive = false) =>
    transport(`${launch.endpoint}statements`, {
      method: 'POST', headers, keepalive,
      body: JSON.stringify({ id: uuid(), actor: launch.actor, verb, object, ...(context ? { context } : {}), timestamp: new Date(now()).toISOString(), ...extra }),
    }).catch(() => null);
  const stateUrl = () => {
    const q = new URLSearchParams({ activityId: launch.activityId, agent: JSON.stringify(launch.actor), stateId: 'scrimshaw-resume' });
    if (launch.registration) q.set('registration', launch.registration);
    return `${launch.endpoint}activities/state?${q}`;
  };
  let suspendData = '';
  try {
    const r = await transport(stateUrl(), { method: 'GET', headers });
    if (r.ok) suspendData = await r.text();
  } catch { /* no saved state */ }
  void send(VERBS.initialized);
  let finished = false;
  let lastSaved = '';
  return {
    connected: true,
    version: null,
    suspendData,
    location: '',
    setProgress(_location, data) {
      if (data === lastSaved) return;
      lastSaved = data;
      void transport(stateUrl(), { method: 'PUT', headers, body: data }).catch(() => null);
    },
    answered(q) {
      void send(VERBS.answered, {
        object: { objectType: 'Activity', id: `${launch.activityId}/question/${q.id}`, definition: { name: { 'en-US': q.title }, type: 'http://adlnet.gov/expapi/activities/cmi.interaction' } },
        result: { success: q.correct, response: q.response.slice(0, 1000), score: q.max > 0 ? { raw: q.points, min: 0, max: q.max, scaled: Math.round((q.points / q.max) * 100) / 100 } : undefined },
      });
    },
    complete(status, scorePercent) {
      const verb = status === 'passed' ? VERBS.passed : status === 'failed' ? VERBS.failed : VERBS.completed;
      const result: Record<string, unknown> = { completion: true, duration: isoDuration(now() - started) };
      if (status !== 'completed') result.success = status === 'passed';
      if (scorePercent !== null) result.score = { scaled: Math.round(scorePercent) / 100, raw: Math.round(scorePercent), min: 0, max: 100 };
      void send(verb, { result });
    },
    finish() {
      if (finished) return;
      finished = true;
      void send(VERBS.terminated, { result: { duration: isoDuration(now() - started) } }, true);
    },
  };
}

function isoDuration(ms: number): string {
  const t = Math.max(0, Math.round(ms / 10)) / 100;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.round((t % 60) * 100) / 100;
  return `PT${h}H${m}M${s}S`;
}
