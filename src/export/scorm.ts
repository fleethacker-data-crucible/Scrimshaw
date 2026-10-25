// SCORM 1.2 packaging and the runtime LMS adapter.
// A published package is the Scrimshaw app itself (one self-contained index.html) with the course
// embedded, so the player in a package is exactly the player in the editor's preview.
import type { Course } from '../model/types.ts';

export const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** SCORM identifiers must be XML ids: letters, digits, dot, dash, underscore; not starting with a digit. */
export function scormId(s: string): string {
  const id = s.replace(/[^A-Za-z0-9._-]/g, '_');
  return /^[A-Za-z_]/.test(id) ? id : `_${id}`;
}

export function manifest12(course: Course): string {
  const id = scormId(`scrimshaw.${course.id}`);
  const title = escapeXml(course.title || 'Untitled course');
  const mastery = course.quiz.reporting === 'passed-failed' ? `\n        <adlcp:masteryscore>${Math.round(course.quiz.passPercent)}</adlcp:masteryscore>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org_1">
    <organization identifier="org_1">
      <title>${title}</title>
      <item identifier="item_1" identifierref="res_1">
        <title>${title}</title>${mastery}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`;
}

/** SCORM 2004 3rd Edition manifest with a simple sequencing (one SCO, no navigation rules). */
export function manifest2004(course: Course): string {
  const id = scormId(`scrimshaw.${course.id}`);
  const title = escapeXml(course.title || 'Untitled course');
  const graded = course.quiz.reporting === 'passed-failed';
  const objectives = graded ? `
          <imsss:sequencing>
            <imsss:objectives>
              <imsss:primaryObjective objectiveID="primary" satisfiedByMeasure="true">
                <imsss:minNormalizedMeasure>${(Math.round(course.quiz.passPercent) / 100).toFixed(2)}</imsss:minNormalizedMeasure>
              </imsss:primaryObjective>
            </imsss:objectives>
          </imsss:sequencing>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 3rd Edition</schemaversion>
  </metadata>
  <organizations default="org_1">
    <organization identifier="org_1">
      <title>${title}</title>
      <item identifier="item_1" identifierref="res_1">
        <title>${title}</title>${objectives}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`;
}

// ---------- runtime adapter (runs inside the LMS frame) ----------

interface Api12 {
  LMSInitialize(a: ''): string;
  LMSFinish(a: ''): string;
  LMSGetValue(k: string): string;
  LMSSetValue(k: string, v: string): string;
  LMSCommit(a: ''): string;
  LMSGetLastError(): string;
}

interface Api2004 {
  Initialize(a: ''): string;
  Terminate(a: ''): string;
  GetValue(k: string): string;
  SetValue(k: string, v: string): string;
  Commit(a: ''): string;
  GetLastError(): string;
}

/** Standard API discovery: walk up parent frames, then the opener's. */
function findInFrames<T>(win: Window, name: 'API' | 'API_1484_11', probe: string): T | null {
  const look = (w: Window | null): T | null => {
    let tries = 0;
    let cur: Window | null = w;
    while (cur && tries++ < 10) {
      try {
        const api = (cur as unknown as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
        if (api && typeof api[probe] === 'function') return api as unknown as T;
      } catch { return null; /* cross-origin frame */ }
      if (cur.parent === cur) break;
      cur = cur.parent;
    }
    return null;
  };
  try { return look(win) ?? (win.opener ? look(win.opener as Window) : null); } catch { return null; }
}

export const findApi = (win: Window) => findInFrames<Api12>(win, 'API', 'LMSInitialize');
export const findApi2004 = (win: Window) => findInFrames<Api2004>(win, 'API_1484_11', 'Initialize');

export interface Lms {
  connected: boolean;
  version: '1.2' | '2004' | null;
  suspendData: string;
  location: string;
  setProgress(location: string, suspendData: string): void;
  complete(status: 'passed' | 'failed' | 'completed', scorePercent: number | null): void;
  finish(): void;
  /** xAPI only: one statement per graded attempt. */
  answered?(question: { id: string; title: string; correct: boolean; response: string; points: number; max: number }): void;
}

/** SCORM 1.2 CMITimespan: HHHH:MM:SS.SS */
export function timespan12(ms: number): string {
  const t = Math.max(0, Math.round(ms / 10)) / 100;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = (t % 60).toFixed(2).padStart(5, '0');
  return `${String(Math.min(h, 9999)).padStart(4, '0')}:${String(m).padStart(2, '0')}:${sec}`;
}

/** SCORM 2004 timeinterval (ISO 8601 duration): PT#H#M#S */
export function duration2004(ms: number): string {
  const t = Math.max(0, Math.round(ms / 10)) / 100;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = Math.round((t % 60) * 100) / 100;
  return `PT${h}H${m}M${sec}S`;
}

/** Connects to a SCORM 2004 or 1.2 LMS if one is found; otherwise returns a no-op adapter. */
export function connectLms(win: Window = window, now: () => number = Date.now): Lms {
  const started = now();
  const a04 = findApi2004(win);
  if (a04) {
    let open = false;
    try { open = a04.Initialize('') === 'true'; } catch { open = false; }
    if (open) return adapter2004(a04, started, now);
  }
  const a12 = findApi(win);
  if (a12) {
    let open = false;
    try { open = a12.LMSInitialize('') === 'true'; } catch { open = false; }
    if (open) return adapter12(a12, started, now);
  }
  return { connected: false, version: null, suspendData: '', location: '', setProgress() {}, complete() {}, finish() {} };
}

function adapter12(api: Api12, started: number, now: () => number): Lms {
  const get = (k: string) => { try { return api.LMSGetValue(k) ?? ''; } catch { return ''; } };
  const set = (k: string, v: string) => { try { api.LMSSetValue(k, v); } catch { /* ignore */ } };
  const commit = () => { try { api.LMSCommit(''); } catch { /* ignore */ } };
  const status = get('cmi.core.lesson_status');
  if (status === 'not attempted' || status === '') set('cmi.core.lesson_status', 'incomplete');
  commit();
  const fresh = get('cmi.core.entry') === 'ab-initio';
  let finished = false;
  return {
    connected: true, version: '1.2',
    suspendData: fresh ? '' : get('cmi.suspend_data'),
    location: fresh ? '' : get('cmi.core.lesson_location'),
    setProgress(location, suspendData) {
      set('cmi.core.lesson_location', location.slice(0, 255));
      if (suspendData.length <= 4096) set('cmi.suspend_data', suspendData);
      set('cmi.core.exit', 'suspend');
      commit();
    },
    complete(st, scorePercent) {
      if (scorePercent !== null) {
        set('cmi.core.score.min', '0');
        set('cmi.core.score.max', '100');
        set('cmi.core.score.raw', String(Math.round(scorePercent)));
      }
      set('cmi.core.lesson_status', st);
      commit();
    },
    finish() {
      if (finished) return;
      finished = true;
      set('cmi.core.session_time', timespan12(now() - started));
      commit();
      try { api.LMSFinish(''); } catch { /* ignore */ }
    },
  };
}

function adapter2004(api: Api2004, started: number, now: () => number): Lms {
  const get = (k: string) => { try { return api.GetValue(k) ?? ''; } catch { return ''; } };
  const set = (k: string, v: string) => { try { api.SetValue(k, v); } catch { /* ignore */ } };
  const commit = () => { try { api.Commit(''); } catch { /* ignore */ } };
  const cs = get('cmi.completion_status');
  if (cs === 'not attempted' || cs === 'unknown' || cs === '') set('cmi.completion_status', 'incomplete');
  commit();
  const fresh = get('cmi.entry') === 'ab-initio';
  let finished = false;
  return {
    connected: true, version: '2004',
    suspendData: fresh ? '' : get('cmi.suspend_data'),
    location: fresh ? '' : get('cmi.location'),
    setProgress(location, suspendData) {
      set('cmi.location', location.slice(0, 1000));
      if (suspendData.length <= 64000) set('cmi.suspend_data', suspendData);
      set('cmi.exit', 'suspend');
      commit();
    },
    complete(st, scorePercent) {
      if (scorePercent !== null) {
        set('cmi.score.min', '0');
        set('cmi.score.max', '100');
        set('cmi.score.raw', String(Math.round(scorePercent)));
        set('cmi.score.scaled', (Math.round(scorePercent) / 100).toFixed(2));
      }
      set('cmi.completion_status', 'completed');
      if (st !== 'completed') set('cmi.success_status', st);
      commit();
    },
    finish() {
      if (finished) return;
      finished = true;
      set('cmi.session_time', duration2004(now() - started));
      commit();
      try { api.Terminate(''); } catch { /* ignore */ }
    },
  };
}
