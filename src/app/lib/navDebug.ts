/**
 * Mobile navigation debug — enable in DevTools:
 *   localStorage.setItem('blyve-nav-debug', '1'); location.reload();
 * Disable:
 *   localStorage.removeItem('blyve-nav-debug');
 *
 * Console helpers:
 *   __blyveNavDebug.dump()       — table of last events
 *   __blyveNavDebug.why()        — short diagnosis of recent nav issues
 *   __blyveNavDebug.lastPop()    — last push/pop/clear with stack trace
 *   __blyveNavDebug.clear()
 *   __blyveNavDebug.enabled()
 */

export type NavDebugSource = 'stack' | 'panel' | 'messages' | 'nav';

export interface NavDebugEntry {
  t: number;
  relMs: number;
  source: NavDebugSource;
  event: string;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 160;
const entries: NavDebugEntry[] = [];
let originTime = typeof performance !== 'undefined' ? performance.now() : 0;
let lastPopEntry: NavDebugEntry | null = null;
let lastPushEntry: NavDebugEntry | null = null;

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem('blyve-nav-debug') === '1') return true;
  } catch {
    /* ignore */
  }
  return import.meta.env.DEV;
}

/** Compact stack trace for who called push/pop/layout. */
function captureTrace(skipFrames = 2): string {
  if (typeof Error === 'undefined' || !Error.captureStackTrace) {
    return new Error().stack?.split('\n').slice(skipFrames + 1, skipFrames + 5).join(' | ') ?? '';
  }
  const err = { stack: '' };
  Error.captureStackTrace(err, captureTrace);
  const lines = (err.stack ?? '')
    .split('\n')
    .slice(1, 6)
    .map((line) => line.trim().replace(/^at /, ''));
  return lines.join(' <- ');
}

function push(source: NavDebugSource, event: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  const now = performance.now();
  if (entries.length === 0) originTime = now;
  const row: NavDebugEntry = {
    t: now,
    relMs: Math.round(now - originTime),
    source,
    event,
    data,
  };
  entries.push(row);
  if (entries.length > MAX_ENTRIES) entries.shift();

  if (event === 'popScreen' || event === 'clearStack' || event === 'onBack') {
    lastPopEntry = row;
  }
  if (event === 'pushScreen') {
    lastPushEntry = row;
  }

  const label = `[Nav:${source}] ${event}`;
  if (data && Object.keys(data).length > 0) {
    console.log(label, data);
  } else {
    console.log(label);
  }
}

function dump() {
  console.table(
    entries.map((e) => ({
      ms: e.relMs,
      src: e.source,
      event: e.event,
      ...(e.data ?? {}),
    })),
  );
  return entries;
}

function clear() {
  entries.length = 0;
  originTime = performance.now();
  lastPopEntry = null;
  lastPushEntry = null;
  console.log('[Nav] debug log cleared');
}

function lastPop() {
  if (lastPopEntry) {
    console.log('[Nav] last pop/back:', lastPopEntry);
  } else {
    console.log('[Nav] no pop/back recorded yet');
  }
  return lastPopEntry;
}

function lastPush() {
  if (lastPushEntry) {
    console.log('[Nav] last push:', lastPushEntry);
  } else {
    console.log('[Nav] no push recorded yet');
  }
  return lastPushEntry;
}

/** Heuristic summary for the "stuck on open" bug. */
function why() {
  const recent = entries.slice(-40);
  const enterStart = [...recent].reverse().find((e) => e.event === 'layout:enter-start');
  const forwardHidden = recent.filter((e) => e.event === 'layout:forward-pull-hidden');
  const staleSnap = recent.filter((e) => e.event === 'snap:complete:stale');
  const staleEnter = recent.filter((e) => e.event === 'enter:complete:stale');
  const pops = recent.filter(
    (e) =>
      e.event === 'popScreen' ||
      e.event === 'onBack' ||
      e.event === 'clearStack',
  );
  const blockedEnter = recent.filter((e) => e.event === 'touch:start:blocked-enter');
  const enterComplete = [...recent].reverse().find((e) => e.event === 'layout:enter-complete');

  console.group('[Nav] why() — diagnosis');
  if (enterStart) {
    console.log('Last enter-start @', enterStart.relMs, 'ms', enterStart.data);
  }
  if (enterComplete) {
    console.log('Last enter-complete @', enterComplete.relMs, 'ms', enterComplete.data);
  }
  if (forwardHidden.length > 0) {
    console.warn(
      `forward-pull-hidden fired ${forwardHidden.length}x in last 40 events — stack was emptied (pop/onBack) during or right after enter`,
      forwardHidden,
    );
  }
  if (pops.length > 0) {
    console.warn('Recent pop/back/clear (check trace field):', pops);
  }
  if (staleSnap.length > 0) {
    console.log('Stale snap callbacks suppressed (good):', staleSnap.length);
  }
  if (staleEnter.length > 0) {
    console.log('Stale enter callbacks suppressed:', staleEnter.length);
  }
  if (blockedEnter.length > 0) {
    console.log('Ghost touches during enter (blocked):', blockedEnter.length);
  }
  if (enterStart && forwardHidden.length > 0 && !enterComplete) {
    console.error(
      'LIKELY BUG: enter interrupted by pop → forward-pull-hidden before enter-complete. See last pop trace.',
    );
    lastPop();
  } else if (enterStart && enterComplete && forwardHidden.length === 0) {
    console.log('Enter completed in logs; if UI still stuck, check panelXPx vs pullPx desync in last settle:open.');
  }
  console.groupEnd();
  return { enterStart, enterComplete, forwardHidden, pops, staleSnap };
}

function panelPose(
  screenId: string | undefined,
  opts: {
    isForwardPull?: boolean;
    translateX?: number;
    panelX?: number;
    width?: number;
    phase?: string;
    skipEnterAnimation?: boolean;
    isSnapAnimating?: boolean;
    isDragging?: boolean;
    swipeBackLocked?: boolean;
    layoutGen?: number;
  },
) {
  const width = opts.width ?? 0;
  const pull = opts.translateX ?? 0;
  const px = opts.panelX ?? 0;
  return {
    screenId: screenId ?? null,
    mode: opts.isForwardPull ? 'forward-pull' : 'stack',
    phase: opts.phase ?? 'idle',
    skipEnter: opts.skipEnterAnimation ?? false,
    pullPx: Math.round(pull),
    panelXPx: Math.round(px),
    viewportW: width ? Math.round(width) : undefined,
    visiblePct: width > 0 ? Math.round((pull / width) * 100) : undefined,
    layoutGen: opts.layoutGen,
    snap: opts.isSnapAnimating ?? false,
    drag: opts.isDragging ?? false,
    lock: opts.swipeBackLocked ?? false,
  };
}

export const navDebug = {
  enabled: isEnabled,
  log: push,
  dump,
  clear,
  why,
  lastPop,
  lastPush,
  captureTrace,
  panelPose,
};

declare global {
  interface Window {
    __blyveNavDebug?: {
      dump: () => NavDebugEntry[];
      clear: () => void;
      enabled: () => boolean;
      why: () => ReturnType<typeof why>;
      lastPop: () => NavDebugEntry | null;
      lastPush: () => NavDebugEntry | null;
      log: typeof push;
      captureTrace: typeof captureTrace;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__blyveNavDebug = {
    dump,
    clear,
    enabled: isEnabled,
    why,
    lastPop,
    lastPush,
    log: push,
    captureTrace,
  };
}
