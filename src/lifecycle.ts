// Lifecycle rules from the Fleet TechStack: the open tab owns the local server. While the editor is open the page
// sends POST /api/heartbeat every 5 s and a "leaving" beacon on pagehide; Start.ps1 stops itself 20 s after the last
// heartbeat (5 s after a leaving beacon with no new heartbeat). "End session" calls the Fleet shutdown endpoint.
// Everything here is injectable so it can be tested without a browser. Editor only: a published course never beats.

export const HEARTBEAT_MS = 5000;
export const HEARTBEAT_URL = '/api/heartbeat';
export const SHUTDOWN_URL = '/__fleethacker/shutdown';

export interface HeartbeatDeps {
  send(body: string): void;
  beacon(body: string): void;
  /** Calls `cb` every `ms`; returns a stop function. */
  ticker(cb: () => void, ms: number): () => void;
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/** Only a page served from this machine over http is ever tracked (not file://, not an LMS, not a published course). */
export function isLocalServer(loc: { protocol: string; hostname: string }): boolean {
  return loc.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(loc.hostname);
}

export function startHeartbeat(d: HeartbeatDeps): () => void {
  d.send('{}');
  const stopTicker = d.ticker(() => d.send('{}'), HEARTBEAT_MS);
  const leave = () => d.beacon('{"leaving":true}');
  // Coming back from the back/forward cache is a reload: say so at once.
  const show = (e: Event) => { if ((e as { persisted?: boolean }).persisted) d.send('{}'); };
  d.target.addEventListener('pagehide', leave);
  d.target.addEventListener('pageshow', show);
  return () => {
    stopTicker();
    d.target.removeEventListener('pagehide', leave);
    d.target.removeEventListener('pageshow', show);
  };
}

/** A timer that a hidden tab does not slow down: a worker's clock is not throttled the way a page's is. */
function workerTicker(cb: () => void, ms: number): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${ms})`], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = cb;
    return () => { w.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(cb, ms);
    return () => clearInterval(id);
  }
}

/** Starts the real heartbeat when this page is served by Start.ps1. Returns a stop function, or null if not applicable. */
export function startBrowserHeartbeat(win: Window = window): (() => void) | null {
  if (!isLocalServer(win.location)) return null;
  return startHeartbeat({
    send: (body) => { void fetch(HEARTBEAT_URL, { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => undefined); },
    beacon: (body) => { try { win.navigator.sendBeacon(HEARTBEAT_URL, body); } catch { /* the server will time out instead */ } },
    ticker: workerTicker,
    target: win,
  });
}

/** Asks the server to stop. True when it said so. */
export async function endSession(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(SHUTDOWN_URL, { method: 'POST', headers: { 'X-FleetHacker-Shutdown': '1' }, credentials: 'omit' });
    return res.ok;
  } catch { return false; }
}
