// Word handout: a plain .docx for review and sign-off, written as a zip of WordprocessingML with JSZip (no
// dependency beyond what publishing already bundles). Text only: slide titles, on-slide text, question setup,
// triggers and notes. The printable HTML storyboard (storyboard.tsx) is the one with slide pictures.
import JSZip from 'jszip';
import { describeTrigger } from '../model/describe.ts';
import { slideTriggers } from '../model/query.ts';
import type { Course, Slide } from '../model/types.ts';
import { escapeXml } from './scorm.ts';

const KIND: Record<string, string> = {
  'multiple-choice': 'Multiple choice', 'multiple-response': 'Multiple response', 'true-false': 'True / false',
  'fill-in': 'Fill in the blank', 'drag-drop': 'Drag and drop', hotspot: 'Hotspot', numeric: 'Numeric', essay: 'Essay',
};

/** Characters XML 1.0 cannot carry are dropped; the rest is escaped. */
const clean = (s: string) => escapeXml(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));

interface Run { text: string; bold?: boolean }
const run = (r: Run) => `<w:r>${r.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${clean(r.text)}</w:t></w:r>`;
/** One paragraph; line breaks in the text become Word line breaks. */
function para(runs: Run[] | string, style?: string, indent = false): string {
  const list = typeof runs === 'string' ? [{ text: runs }] : runs;
  const body = list.map((r) => r.text.split(/\r?\n/).map((line) => run({ ...r, text: line })).join('<w:r><w:br/></w:r>')).join('');
  const props = style || indent ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? '<w:ind w:left="360"/>' : ''}</w:pPr>` : '';
  return `<w:p>${props}${body}</w:p>`;
}
const bullet = (runs: Run[] | string) => para(typeof runs === 'string' ? [{ text: `• ${runs}` }] : [{ text: '• ' }, ...runs], undefined, true);

function slideParagraphs(course: Course, slide: Slide, n: number): string[] {
  const out: string[] = [para(`${n}. ${slide.title}`, 'Heading2')];
  const objs = slide.layers.flatMap((l) => l.objects);
  const texts = objs.filter((o) => (o.kind === 'text' || o.kind === 'button' || o.kind === 'choice' || o.kind === 'shape') && o.text.trim());
  if (texts.length) {
    out.push(para([{ text: 'On the slide', bold: true }]));
    for (const o of texts) out.push(bullet(o.text.replace(/\s*\n\s*/g, ' / ')));
  }
  out.push(para([{ text: 'Timeline: ', bold: true }, { text: `${slide.duration}s, ${slide.advance === 'auto' ? 'advances automatically' : 'learner advances'}` }]));
  if (slide.layers.length > 1) out.push(para([{ text: 'Layers: ', bold: true }, { text: slide.layers.slice(1).map((l) => l.name).join(', ') }]));
  const q = slide.question;
  if (q) {
    out.push(para([{ text: 'Question: ', bold: true }, { text: `${KIND[q.kind] ?? q.kind}${q.graded ? `, ${q.points} points` : ', not scored'}, ${q.attempts === 0 ? 'unlimited attempts' : `${q.attempts} attempt${q.attempts > 1 ? 's' : ''}`}` }]));
    if (q.kind === 'fill-in') out.push(para([{ text: 'Accepted: ', bold: true }, { text: q.accepted.filter(Boolean).join(' | ') }]));
    if (q.kind === 'numeric') out.push(para([{ text: 'Accepted: ', bold: true }, { text: q.numMin === q.numMax ? String(q.numMin) : `${q.numMin} to ${q.numMax}` }]));
    if (['multiple-choice', 'multiple-response', 'true-false'].includes(q.kind)) {
      for (const o of objs.filter((x) => x.kind === 'choice')) out.push(bullet(`${q.graded ? (o.correct ? '[correct] ' : '[wrong] ') : ''}${o.text}`));
    }
    if (q.kind === 'drag-drop') {
      for (const o of objs.filter((x) => x.draggable)) {
        const t = objs.find((x) => x.id === o.correctTargetId);
        out.push(bullet(q.graded ? `${o.text || o.name} -> ${t ? (t.text || t.name) : 'anywhere'}` : (o.text || o.name)));
      }
    }
    if (q.kind === 'hotspot') out.push(para([{ text: 'Correct areas: ', bold: true }, { text: objs.filter((o) => o.kind === 'hotspot' && o.correct).map((o) => o.name).join(', ') }]));
  }
  const triggers = slideTriggers(slide);
  if (triggers.length) {
    out.push(para([{ text: 'Triggers', bold: true }]));
    for (const { trigger, layer, object } of triggers) {
      const d = describeTrigger(course, slide, trigger, object);
      out.push(bullet(`${d.action} when ${d.when}${d.conditions ? ` if ${d.conditions}` : ''} (on ${object ? object.name : layer ? `layer ${layer.name}` : 'the slide'})`));
    }
  }
  if (slide.notes.trim()) out.push(para([{ text: 'Notes: ', bold: true }, { text: slide.notes.trim() }]));
  return out;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The files of the package, by path. Pure and deterministic, so it can be tested without a zip. */
export function docxParts(course: Course): Record<string, string> {
  const body: string[] = [para(course.title, 'Title')];
  const slideCount = course.scenes.reduce((n, s) => n + s.slides.length, 0);
  body.push(para(`Storyboard handout: ${slideCount} slide${slideCount === 1 ? '' : 's'} in ${course.scenes.length} scene${course.scenes.length === 1 ? '' : 's'}`));
  if (course.description.trim()) body.push(para(course.description.trim()));
  if (course.variables.length) body.push(para([{ text: 'Variables: ', bold: true }, { text: course.variables.map((v) => `${v.name} (${v.type}, starts ${JSON.stringify(v.initial)})`).join(', ') }]));
  let n = 0;
  for (const scene of course.scenes) {
    body.push(para(`Scene: ${scene.name}`, 'Heading1'));
    for (const slide of scene.slides) body.push(...slideParagraphs(course, slide, ++n));
  }
  const sz = (style: string, name: string, size: number, bold: boolean, after: number) =>
    `<w:style w:type="paragraph" w:styleId="${style}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="${after}"/></w:pPr><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr></w:style>`;
  return {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/styles.xml': `${HEAD}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${sz('Title', 'Title', 52, true, 120)}${sz('Heading1', 'heading 1', 32, true, 120)}${sz('Heading2', 'heading 2', 26, true, 80)}</w:styles>`,
    'word/document.xml': `${HEAD}<w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
}

export async function buildDocx(course: Course): Promise<Blob> {
  const zip = new JSZip();
  // [Content_Types].xml first, as Word expects.
  for (const [path, xml] of Object.entries(docxParts(course))) zip.file(path, xml, { createFolders: false });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
