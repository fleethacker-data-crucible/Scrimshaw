import { uid } from '../model/factory.ts';
import type { Asset, Course } from '../model/types.ts';
import { vttToDataUrl } from '../render/vtt.ts';

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** Reads a media file into an asset. Throws a readable error for the wrong type or size. */
export async function fileToAsset(file: File, kind: 'image' | 'video' | 'audio'): Promise<Asset> {
  if (!file.type.startsWith(`${kind}/`)) throw new Error(`“${file.name}” is not ${kind === 'image' ? 'an image' : kind === 'video' ? 'a video' : 'an audio file'}.`);
  if (file.size > MAX_MEDIA_BYTES) throw new Error(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_MEDIA_BYTES / 1048576} MB per file.`);
  return { id: uid('a'), name: file.name, mime: file.type, data: await readFileAsDataUrl(file) };
}

/** Assets are shared between undo steps, so adding one makes a new map rather than mutating. */
export function withAsset(c: Course, a: Asset) {
  c.assets = { ...c.assets, [a.id]: a };
}

/** Natural size of an image data URL, scaled to fit inside the slide. */
export function imageSize(src: string, maxW: number, maxH: number): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      resolve({ w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) });
    };
    img.onerror = () => resolve({ w: 320, h: 200 });
    img.src = src;
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Reads a WebVTT captions file into an asset. */
export async function captionsToAsset(file: File): Promise<Asset> {
  if (!/\.vtt$/i.test(file.name) && file.type !== 'text/vtt') throw new Error(`“${file.name}” is not a WebVTT (.vtt) captions file.`);
  if (file.size > 2 * 1024 * 1024) throw new Error(`“${file.name}” is larger than 2 MB.`);
  const text = await file.text();
  if (!/^\ufeff?WEBVTT/.test(text)) throw new Error(`“${file.name}” does not start with WEBVTT, so it is not a valid captions file.`);
  return { id: uid('a'), name: file.name, mime: 'text/vtt', data: vttToDataUrl(text) };
}
