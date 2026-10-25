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

// ---------- runtime adapter (runs inside the LMS frame) ----------

interface Api12 {
  LMSInitialize(a: ''): string;
  LMSFinish(a: ''): string;
  LMSGetValue(k: string): string;
  LMSSetValue(k: string, v: string): string;
  LMSCommit(a: ''): string;
  LMSGetLastError(): string;
}

/** Standard API discovery: walk up parent frames, then the opener's. */
export function findApi(win: Window): Api12 | null {
  const look = (w: Window | null): Api12 | null => {
    let tries = 0;
    let cur: Window | null = w;
    while (cur && tries++ < 10) {
      try {
        const api = (cur as unknown as { API?: Api12 }).API;
        if (api && typeof api.LMSInitialize === 'function') return api;
      } catch { return null; /* cross-origin frame */ }
      if (cur.parent === cur) break;
      cur = cur.parent;
    }
    return null;
  };
  return look(win) ?? (win.opener ? look(win.opener as Window) : null);
}

export interface Lms {
  connected: boolean;
  suspendData: string;
  location: string;
  setProgress(location: string, suspendData: string): void;
  complete(status: 'passed' | 'failed' | 'completed', scorePercent: number | null): void;
  finish(): void;
}

export function connectLms(win: Window = window): Lms {
  const api = findApi(win);
  let open = false;
  if (api) {
    try { open = api.LMSInitialize('') === 'true'; } catch { open = false; }
  }
  const get = (k: string) => { try { return open && api ? api.LMSGetValue(k) ?? '' : ''; } catch { return ''; } };
  const set = (k: string, v: string) => { try { if (open && api) api.LMSSetValue(k, v); } catch { /* ignore */ } };
  const commit = () => { try { if (open && api) api.LMSCommit(''); } catch { /* ignore */ } };
  if (open) {
    const status = get('cmi.core.lesson_status');
    if (status === 'not attempted' || status === '') set('cmi.core.lesson_status', 'incomplete');
    commit();
  }
  const entry = get('cmi.core.entry');
  let finished = false;
  return {
    connected: open,
    suspendData: entry === 'ab-initio' ? '' : get('cmi.suspend_data'),
    location: entry === 'ab-initio' ? '' : get('cmi.core.lesson_location'),
    setProgress(location, suspendData) {
      if (!open) return;
      set('cmi.core.lesson_location', location.slice(0, 255));
      if (suspendData.length <= 4096) set('cmi.suspend_data', suspendData);
      set('cmi.core.exit', 'suspend');
      commit();
    },
    complete(status, scorePercent) {
      if (!open) return;
      if (scorePercent !== null) {
        set('cmi.core.score.min', '0');
        set('cmi.core.score.max', '100');
        set('cmi.core.score.raw', String(Math.round(scorePercent)));
      }
      set('cmi.core.lesson_status', status);
      commit();
    },
    finish() {
      if (!open || finished) return;
      finished = true;
      try { api?.LMSFinish(''); } catch { /* ignore */ }
    },
  };
}
