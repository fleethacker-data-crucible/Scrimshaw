// Publishing. The built app is a single self-contained HTML file; at startup main.tsx keeps a
// copy of that HTML (the "shell"). Publishing writes the course into the shell as JSON, so the
// output is a standalone player that works offline, from file://, or inside an LMS.
import JSZip from 'jszip';
import { pruneAssets } from '../store/ops.ts';
import type { Course } from '../model/types.ts';
import { manifest12, manifest2004 } from './scorm.ts';
import { cmi5Xml, tincanXml } from './xapi.ts';

export const COURSE_SCRIPT_ID = 'scrimshaw-course';

let shell: string | null = null;

/** Called once at boot, before React renders, while the DOM is still the pristine shell. */
export function captureShell(doc: Document) {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector(`#${COURSE_SCRIPT_ID}`)?.remove();
  const root = clone.querySelector('#root');
  if (root) root.innerHTML = '';
  clone.removeAttribute('data-theme');
  clone.removeAttribute('data-reduced-motion');
  clone.classList.remove('light');
  shell = '<!doctype html>\n' + clone.outerHTML;
}

export function canPublish(): boolean {
  // In a dev build the shell references external module files and cannot stand alone.
  return !!shell && shell.includes('data-scrimshaw-bundle');
}

/** JSON that is safe inside <script>: no "</script>", no HTML comment openers, no line separators. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildPlayerHtml(course: Course, template: string | null = shell): string {
  if (!template) throw new Error('Publishing needs the built app (dist/index.html).');
  const packed: Course = { ...course, assets: pruneAssets(course) };
  const title = course.title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const tag = `<script id="${COURSE_SCRIPT_ID}" type="application/json">${scriptSafeJson(packed)}</script>`;
  // Function replacers: a string replacement would expand "$&" and friends found in course text.
  // The app bundle sits at the end of <body>, so the first </head> is the real one.
  let html = template.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
  html = html.replace('</head>', () => `${tag}\n</head>`);
  return html;
}

export async function buildScormZip(course: Course, template: string | null = shell, version: '1.2' | '2004' = '1.2'): Promise<Blob> {
  const zip = new JSZip();
  zip.file('index.html', buildPlayerHtml(course, template));
  zip.file('imsmanifest.xml', version === '2004' ? manifest2004(course) : manifest12(course));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
}

/** xAPI package: the player must reach the LRS, so its CSP allows connections (http/https only). */
export async function buildXapiZip(course: Course, template: string | null = shell, profile: 'tincan' | 'cmi5' = 'tincan'): Promise<Blob> {
  const zip = new JSZip();
  const html = buildPlayerHtml(course, template).replace("connect-src 'none'", () => 'connect-src https: http:');
  zip.file('index.html', html);
  if (profile === 'cmi5') zip.file('cmi5.xml', cmi5Xml(course));
  else zip.file('tincan.xml', tincanXml(course));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
}

export function fileName(title: string, ext: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'course';
  return `${base}.${ext}`;
}

/** Hands a file to the browser's download flow. */
export function download(name: string, data: Blob | string, mime = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Reads an embedded course from a published package, if this page is one. */
export function embeddedCourseJson(doc: Document): string | null {
  const el = doc.getElementById(COURSE_SCRIPT_ID);
  return el?.textContent ?? null;
}
