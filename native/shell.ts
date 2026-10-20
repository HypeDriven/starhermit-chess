// What every screen shares: the router, toasts, the theme and a name cache.
import { frame } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { player, profile, type PlatformError } from "starhermit:platform";
import { PALETTE } from "./board.js";
import { T } from "./i18n.js";

export interface Screen {
  /** Once a frame: lay out widgets and draw. */
  update(): void;
  /** A press on the window (pointer or touch) not taken by a widget. */
  press?(x: number, y: number): void;
  /** One of the manifest's actions was pressed. */
  action?(name: string): void;
  /** A key press (KeyboardEvent.code), for keys that are not actions. */
  key?(code: string): void;
  dispose?(): void;
}

let current: Screen | null = null;
export function show(next: Screen): void {
  current?.dispose?.();
  current = next;
}
export function screen(): Screen | null { return current; }

/** Opens a screen by name; main.ts fills these in (screens never import each other). */
export const nav = {
  club(): void { /* set by main.ts */ },
  /** A platform session, or null for offline practice against hal. */
  table(_sessionId: string | null): void { /* set by main.ts */ },
  replay(_sessionId: string): void { /* set by main.ts */ },
};

// -- Toasts -------------------------------------------------------------------
const toasts: { text: string; until: number; danger: boolean }[] = [];
export function toast(text: string, danger = false): void {
  toasts.push({ text, until: frame().time + 4.2, danger });
  if (toasts.length > 4) toasts.shift();
}
export function drawToasts(): void {
  const { width, height, time, scale } = frame();
  while (toasts.length && toasts[0]!.until < time) toasts.shift();
  let y = height - 24 * scale;
  const size = 15 * scale;
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i]!;
    const m = draw.measureText(t.text, { size, maxWidth: Math.min(width - 48 * scale, 560 * scale) });
    const w = m.width + 32 * scale, h = m.height + 18 * scale;
    y -= h;
    draw.roundRect((width - w) / 2, y, w, h, 6 * scale, t.danger ? PALETTE.danger : PALETTE.panel2);
    draw.text(t.text, width / 2, y + 9 * scale, { size, color: PALETTE.ink, align: "center", maxWidth: m.width + 1 });
    y -= 8 * scale;
  }
}

/** A platform failure as a short line for a toast. */
export function errorText(e: unknown): string {
  const pe = e as Partial<PlatformError>;
  if (pe && pe.name === "PlatformError") return pe.message || pe.kind || "error";
  return String((e as Error)?.message ?? e);
}

export function setTheme(): void {
  ui.setTheme({
    text: PALETTE.ink, muted: PALETTE.muted, panel: PALETTE.panel, control: PALETTE.panel2,
    hovered: PALETTE.line, pressed: PALETTE.brass, field: PALETTE.bg, accent: PALETTE.brass,
    focus: PALETTE.brassHi, outline: PALETTE.line,
  });
}

// -- Names ----------------------------------------------------------------------
const names = new Map<string, string>();
const asked = new Set<string>();
/** A player's display name (nickname when they have one); `fallback` until it loads. */
export function nameOf(userId: string | null | undefined, fallback = "?"): string {
  if (!userId) return fallback;
  const me = player();
  if (me && me.userId === userId) return me.displayName;
  const n = names.get(userId);
  if (n) return n;
  if (!asked.has(userId)) {
    asked.add(userId);
    profile(userId).then((p) => { names.set(userId, p.displayName); }, () => { /* keep the fallback */ });
  }
  return fallback;
}
export function rememberName(userId: string, username: string): void {
  if (!names.has(userId)) names.set(userId, username);
}

/** Two-column layout: the board on one side, a panel beside it (or below on a
 * tall window). Rects are window pixels. */
export function splitLayout(): { board: { x: number; y: number; width: number; height: number }; side: { x: number; y: number; width: number; height: number } } {
  const { width, height, scale, safeArea } = frame();
  const pad = 16 * scale;
  const x0 = safeArea.left + pad, y0 = safeArea.top + pad;
  const w = width - safeArea.left - safeArea.right - pad * 2;
  const h = height - safeArea.top - safeArea.bottom - pad * 2;
  if (w >= h * 1.25) {
    const side = Math.max(300 * scale, Math.min(w * 0.42, 460 * scale));
    const size = Math.min(h - 120 * scale, w - side - pad);
    const by = y0 + 56 * scale;
    return {
      board: { x: x0, y: by, width: size, height: size },
      side: { x: x0 + size + pad * 1.5, y: y0, width: w - size - pad * 1.5, height: h },
    };
  }
  const size = Math.min(w, h * 0.58);
  const bx = x0 + (w - size) / 2, by = y0 + 56 * scale;
  return {
    board: { x: bx, y: by, width: size, height: size },
    side: { x: x0, y: by + size + pad + 48 * scale, width: w, height: h - (by - y0) - size - pad - 48 * scale },
  };
}

export { T };
