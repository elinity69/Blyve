/**
 * EmojiPickerPopover — portal-based, viewport-safe emoji picker.
 *
 * Renders emoji-mart Picker into document.body at a computed position
 * anchored to an (x, y) coordinate (e.g. pointer or button position).
 * Auto-adjusts to stay inside the viewport on all sides.
 * Persists chosen skin tone to localStorage.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import i18n from '../../../lib/i18n';

const PICKER_WIDTH = 352;
const PICKER_HEIGHT = 435;
const VIEWPORT_PADDING = 8;
const OPEN_GRACE_MS = 200;
const SKIN_TONE_KEY = 'blyve_reaction_skin_tone';

interface EmojiPickerPopoverProps {
  x: number;
  y: number;
  onEmojiSelect: (emoji: string) => void;
  onClose: () => void;
}

function resolveLocale(): string {
  const lang = i18n.language?.split('-')[0] ?? 'en';
  const supported = new Set(['en', 'ar', 'be', 'cs', 'de', 'es', 'fa', 'fi', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sa', 'tr', 'uk', 'vi', 'zh']);
  return supported.has(lang) ? lang : 'en';
}

function loadSkinTone(): number {
  try {
    const saved = localStorage.getItem(SKIN_TONE_KEY);
    const n = saved ? parseInt(saved, 10) : NaN;
    return n >= 1 && n <= 6 ? n : 1;
  } catch {
    return 1;
  }
}

function saveSkinTone(tone: number): void {
  try { localStorage.setItem(SKIN_TONE_KEY, String(tone)); } catch { /* ignore */ }
}

export function EmojiPickerPopover({
  x,
  y,
  onEmojiSelect,
  onClose,
}: EmojiPickerPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(Date.now());
  const [position, setPosition] = useState({ x, y });
  const [skinTone, setSkinTone] = useState<number>(loadSkinTone);

  const handleSkinToneChange = useCallback((tone: number) => {
    setSkinTone(tone);
    saveSkinTone(tone);
  }, []);

  useLayoutEffect(() => {
    openedAtRef.current = Date.now();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const p = VIEWPORT_PADDING;
    let nx = x;
    let ny = y;
    if (nx + PICKER_WIDTH > vw - p) nx = vw - PICKER_WIDTH - p;
    if (ny + PICKER_HEIGHT > vh - p) ny = Math.max(p, vh - PICKER_HEIGHT - p);
    if (nx < p) nx = p;
    if (ny < p) ny = p;
    setPosition({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (Date.now() - openedAtRef.current < OPEN_GRACE_MS) return;
      if (containerRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[600]"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Picker
        data={data}
        locale={resolveLocale()}
        theme="dark"
        set="native"
        previewPosition="none"
        skinTonePosition="search"
        skin={skinTone}
        onSkinToneChange={handleSkinToneChange}
        onEmojiSelect={(em: { native?: string }) => {
          if (em.native) {
            onEmojiSelect(em.native);
            onClose();
          }
        }}
        autoFocus
      />
    </div>,
    document.body
  );
}
