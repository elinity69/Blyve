/**
 * Mobile navigation debug — enable in DevTools:
 *   localStorage.setItem('blyve-nav-debug', '1'); location.reload();
 * Disable:
 *   localStorage.removeItem('blyve-nav-debug');
 *
 * Console helpers:
 *   __blyveNavDebug.dump()     — last 80 events
 *   __blyveNavDebug.clear()
 *   __blyveNavDebug.enabled()
 */

export type NavDebugSource = 'stack' | 'panel' | 'messages';

export interface NavDebugEntry {
  t: number;
  relMs: number;
  source: NavDebugSource;
  event: string;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 120;
const entries: NavDebugEntry[] = [];
let originTime = typeof performance !== 'undefined' ? performance.now() : 0;

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem('blyve-nav-debug') === '1') return true;
  } catch {
    /* ignore */
  }
  return import.meta.env.DEV;
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
  console.log('[Nav] debug log cleared');
}

function panelPose(
  screenId: string | undefined,
  opts: {
    isForwardPull?: boolean;
    translateX?: number;
    motionX?: number;
    width?: number;
    isSwipeDragging?: boolean;
  },
) {
  return {
    screenId: screenId ?? null,
    mode: opts.isForwardPull ? 'forward-pull' : 'stack',
    translateX: opts.translateX != null ? Math.round(opts.translateX) : undefined,
    motionX: opts.motionX != null ? Math.round(opts.motionX) : undefined,
    viewportW: opts.width != null ? Math.round(opts.width) : undefined,
    dragging: opts.isSwipeDragging ?? false,
  };
}

export const navDebug = {
  enabled: isEnabled,
  log: push,
  dump,
  clear,
  panelPose,
};

declare global {
  interface Window {
    __blyveNavDebug?: {
      dump: () => NavDebugEntry[];
      clear: () => void;
      enabled: () => boolean;
      log: typeof push;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__blyveNavDebug = {
    dump,
    clear,
    enabled: isEnabled,
    log: push,
  };
}
