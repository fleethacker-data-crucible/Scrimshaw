// Loopback client for the Fleet action API. The token stays in this module's memory
// and is sent only as a request header. It is never written into the page.
import type { Course } from '../model/types.ts';

export interface ActionError { code: string; message: string }
export type ActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: ActionError };

let token: string | null = null;
let probe: Promise<boolean> | null = null;

/** True when this page was served with Start.ps1 -Api. A file:// page is never that. */
export function fleetApiReady(): Promise<boolean> {
  if (probe) return probe;
  probe = (async () => {
    try {
      if (typeof location === 'undefined' || location.protocol !== 'http:') return false;
      if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return false;
      const res = await fetch('/api/session', { credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return false;
      const body = await res.json() as { token?: unknown };
      if (typeof body.token !== 'string' || body.token.length < 16) return false;
      token = body.token;
      return true;
    } catch {
      return false;
    }
  })();
  return probe;
}

export async function callFleetAction(id: string, args: Record<string, unknown>): Promise<ActionResult> {
  const ready = await fleetApiReady();
  if (!ready || !token) return { ok: false, error: { code: 'offline', message: 'The action API is not running. Start Scrimshaw with -Api.' } };
  const parts = id.split('.');
  if (parts.length !== 3) return { ok: false, error: { code: 'usage', message: `Unknown action ${id}.` } };
  let res: Response;
  try {
    res = await fetch(`/api/actions/${parts[0]}/${parts[1]}/${parts[2]}`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Fleet-Action-Token': token,
      },
      body: JSON.stringify(args),
    });
  } catch {
    return { ok: false, error: { code: 'unreachable', message: 'The action API did not answer.' } };
  }
  let body: { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } };
  try { body = await res.json(); } catch {
    return { ok: false, error: { code: 'bad-response', message: 'The action API did not return JSON.' } };
  }
  if (!body.ok) {
    return { ok: false, error: { code: body.error?.code || 'error', message: body.error?.message || 'Scrimshaw could not finish that action.' } };
  }
  return { ok: true, data: body.data ?? {} };
}

/** Copies an action result onto the editor draft so undo still has the previous course. */
export function adoptCourse(draft: Course, next: Course) {
  draft.schema = next.schema;
  draft.id = next.id;
  draft.title = next.title;
  draft.author = next.author;
  draft.description = next.description;
  draft.size = next.size;
  draft.scenes = next.scenes;
  draft.master = next.master;
  draft.variables = next.variables;
  draft.theme = next.theme;
  draft.startSlideId = next.startSlideId;
  draft.player = next.player;
  draft.quiz = next.quiz;
  draft.assets = next.assets;
  draft.created = next.created;
  draft.modified = next.modified;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
