// Best-effort PowerPoint import: one Scrimshaw slide per .pptx slide, with its text boxes
// (position, size, font size, bold, colour, alignment), pictures and a solid background colour.
// Charts, SmartArt, tables, animations and master graphics are not imported.
import JSZip from 'jszip';
import { baseStyle, newObject, newSlide, uid } from '../model/factory.ts';
import type { Asset, Slide, SlideObject } from '../model/types.ts';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PX = 9525;

export interface PptxImport { slides: Slide[]; assets: Asset[]; size: { w: number; h: number }; skipped: number }

const mimeOf = (name: string) => {
  const ext = name.split('.').pop()!.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' } as Record<string, string>)[ext] ?? '';
};

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function rels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const file = `${dir}/_rels/${partPath.split('/').pop()}.rels`;
  const xml = await zip.file(file)?.async('string');
  const map = new Map<string, string>();
  if (!xml) return map;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    map.set(r.getAttribute('Id') ?? '', resolvePath(partPath, r.getAttribute('Target') ?? ''));
  }
  return map;
}

const first = (el: Element | Document, ns: string, name: string) => el.getElementsByTagNameNS(ns, name)[0] as Element | undefined;
const all = (el: Element | Document, ns: string, name: string) => Array.from(el.getElementsByTagNameNS(ns, name));

function box(el: Element, scale: number) {
  const off = first(el, A, 'off');
  const ext = first(el, A, 'ext');
  if (!off || !ext) return null;
  const px = (v: string | null) => (Number(v) || 0) / EMU_PER_PX * scale;
  return { x: Math.round(px(off.getAttribute('x'))), y: Math.round(px(off.getAttribute('y'))), w: Math.max(8, Math.round(px(ext.getAttribute('cx')))), h: Math.max(8, Math.round(px(ext.getAttribute('cy')))) };
}

function color(el: Element | undefined): string | null {
  const c = el && first(el, A, 'srgbClr');
  return c ? `#${(c.getAttribute('val') ?? '000000').toLowerCase()}` : null;
}

function textOf(sp: Element): { text: string; size: number | null; bold: boolean; italic: boolean; color: string | null; align: 'left' | 'center' | 'right' } {
  const paras = all(sp, A, 'p');
  const lines: string[] = [];
  let size: number | null = null;
  let bold = false;
  let italic = false;
  let col: string | null = null;
  let align: 'left' | 'center' | 'right' = 'left';
  paras.forEach((p, i) => {
    const pPr = first(p, A, 'pPr');
    if (i === 0 && pPr) align = pPr.getAttribute('algn') === 'ctr' ? 'center' : pPr.getAttribute('algn') === 'r' ? 'right' : 'left';
    const bullet = pPr && (first(pPr, A, 'buChar') || first(pPr, A, 'buAutoNum'));
    const runs = all(p, A, 'r').map((r) => {
      const rPr = first(r, A, 'rPr');
      if (rPr) {
        if (size === null && rPr.getAttribute('sz')) size = Number(rPr.getAttribute('sz')) / 100;
        if (rPr.getAttribute('b') === '1') bold = true;
        if (rPr.getAttribute('i') === '1') italic = true;
        col ??= color(first(rPr, A, 'solidFill'));
      }
      return first(r, A, 't')?.textContent ?? '';
    }).join('');
    lines.push(bullet && runs ? `- ${runs}` : runs);
  });
  return { text: lines.join('\n').replace(/\n+$/, ''), size, bold, italic, color: col, align };
}

/** Reads a .pptx (as ArrayBuffer) into slides sized for a slide of `targetW` pixels wide. */
export async function importPptx(data: ArrayBuffer, targetW = 960): Promise<PptxImport> {
  const zip = await JSZip.loadAsync(data);
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXml) throw new Error('This is not a PowerPoint (.pptx) file.');
  const pres = new DOMParser().parseFromString(presXml, 'application/xml');
  const sz = first(pres, P, 'sldSz');
  const cx = Number(sz?.getAttribute('cx')) || 12192000;
  const cy = Number(sz?.getAttribute('cy')) || 6858000;
  const scale = targetW / (cx / EMU_PER_PX);
  const size = { w: targetW, h: Math.round((cy / EMU_PER_PX) * scale) };
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const order = all(pres, P, 'sldId').map((s) => presRels.get(s.getAttributeNS(R, 'id') ?? s.getAttribute('r:id') ?? '')).filter((p): p is string => !!p);
  const assets = new Map<string, Asset>();
  const slides: Slide[] = [];
  let skipped = 0;
  for (const path of order) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const relMap = await rels(zip, path);
    const slide = newSlide(`Slide ${slides.length + 1}`);
    const bg = first(doc, P, 'bg');
    const bgColor = bg ? color(first(bg, A, 'solidFill')) : null;
    if (bgColor) slide.background = bgColor;
    const objs: SlideObject[] = [];
    let title: string | null = null;
    const tree = first(doc, P, 'spTree');
    for (const el of tree ? Array.from(tree.children) : []) {
      const local = el.localName;
      if (local === 'sp') {
        const b = box(el, scale);
        const t = textOf(el);
        if (!b || !t.text.trim()) { if (!b) skipped++; continue; }
        const ph = first(el, P, 'ph');
        const isTitle = !!ph && ['title', 'ctrTitle'].includes(ph.getAttribute('type') ?? '');
        if (isTitle && !title) title = t.text.split('\n')[0].slice(0, 80);
        // Only the shape's own fill (a direct child of spPr), not its outline's.
        const spPr = first(el, P, 'spPr');
        const fillEl = spPr ? Array.from(spPr.children).find((c) => c.localName === 'solidFill') : undefined;
        const fill = fillEl ? color(fillEl) : null;
        const px = Math.round((t.size ?? (isTitle ? 40 : 18)) * (96 / 72) * scale);
        objs.push(newObject(fill ? 'shape' : 'text', {
          name: isTitle ? 'Title' : t.text.split('\n')[0].replace(/^- /, '').slice(0, 30) || 'Text', ...b, text: t.text, shape: 'rect',
          style: baseStyle({ fontSize: Math.max(8, px), fontWeight: t.bold || isTitle ? 600 : 400, italic: t.italic, color: t.color ?? '#1a1a19', align: t.align, fill: fill ?? 'transparent', valign: fill ? 'middle' : 'top' }),
        }));
      } else if (local === 'pic') {
        const b = box(el, scale);
        const blip = first(el, A, 'blip');
        const target = blip && relMap.get(blip.getAttributeNS(R, 'embed') ?? '');
        const mime = target ? mimeOf(target) : '';
        if (!b || !target || !mime) { skipped++; continue; }
        let asset = assets.get(target);
        if (!asset) {
          const base64 = await zip.file(target)?.async('base64');
          if (!base64) { skipped++; continue; }
          asset = { id: uid('a'), name: target.split('/').pop()!, mime, data: `data:${mime};base64,${base64}` };
          assets.set(target, asset);
        }
        const descr = first(el, P, 'cNvPr')?.getAttribute('descr') ?? '';
        objs.push(newObject('image', { name: first(el, P, 'cNvPr')?.getAttribute('name') ?? 'Picture', ...b, src: `asset:${asset.id}`, alt: descr, decorative: false }));
      } else if (local === 'graphicFrame' || local === 'grpSp') {
        skipped++;
      }
    }
    const notesPath = [...relMap.values()].find((p) => p.includes('notesSlide'));
    if (notesPath) {
      const nx = await zip.file(notesPath)?.async('string');
      if (nx) {
        const nd = new DOMParser().parseFromString(nx, 'application/xml');
        slide.notes = all(nd, P, 'sp').filter((sp) => first(sp, P, 'ph')?.getAttribute('type') === 'body')
          .map((sp) => all(sp, A, 't').map((t) => t.textContent).join(' ')).join('\n').trim();
      }
    }
    if (title) slide.title = title;
    slide.layers[0].objects = objs;
    slides.push(slide);
  }
  if (slides.length === 0) throw new Error('No slides were found in this file.');
  return { slides, assets: [...assets.values()], size, skipped };
}
