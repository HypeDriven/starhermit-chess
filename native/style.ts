// The club room's look, as the browser client drew it: brass on walnut,
// serif headings, framed panels, a top bar with the wordmark. Widgets take
// their colours from the theme, so a brass button switches the theme for
// that one widget and back.
import { createImageBitmap, OffscreenCanvas, type ImageBitmap } from "starhermit:canvas";
import { frame, openMenu } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { PALETTE } from "./board.js";
import { T } from "./i18n.js";
import { currentClip, TOP_BAR } from "./shell.js";
import { soundOn, toggleSound } from "./sfx.js";

export { TOP_BAR };

/** Text on brass (the browser client's --brass-ink). */
export const BRASS_INK = "#1c150e";

const THEME: ui.Theme = {
  fontSize: 15, smallSize: 13,
  text: PALETTE.ink, muted: PALETTE.muted, panel: PALETTE.panel, control: PALETTE.panel2,
  hovered: PALETTE.line, pressed: PALETTE.brass, field: PALETTE.bg, accent: PALETTE.brass,
  focus: PALETTE.brassHi, outline: PALETTE.line,
};
export function setTheme(): void { ui.setTheme(THEME); }

/** The filled brass button (Play): `big` is the menu's large serif one. */
export function primaryButton(id: string, label: string, options: { big?: boolean; disabled?: boolean } = {}): boolean {
  ui.setTheme({ ...THEME, control: PALETTE.brass, hovered: PALETTE.brassHi, pressed: PALETTE.brassHi, text: BRASS_INK, muted: BRASS_INK });
  // Em spaces give the big button the browser client's 44-pixel side padding.
  const hit = ui.id(id).button(options.big ? `\u2003${label}\u2003` : label, options.big
    ? { font: "serif", size: 20, weight: "600", disabled: !!options.disabled }
    : { weight: "600", disabled: !!options.disabled });
  ui.setTheme(THEME);
  return hit;
}

/** A small secondary button. */
export function smallButton(id: string, label: string, options: { tone?: ui.Tone } = {}): boolean {
  return ui.id(id).button(label, { size: 13, tone: options.tone ?? "normal" });
}

/** A card's name, as a button that blends into the card (serif, card fill). */
export function cardButton(id: string, label: string): boolean {
  ui.setTheme({ ...THEME, control: PALETTE.panel2, hovered: PALETTE.line });
  const hit = ui.id(id).button(label, { font: "serif", size: 16 });
  ui.setTheme(THEME);
  return hit;
}

/** The small turn pill on a game card: brass when it is the player's move. */
export function pill(id: string, text: string, mine: boolean): void {
  const r = ui.row(id, () => {
    ui.label(text.toUpperCase(), { size: 11, weight: "600", color: mine ? BRASS_INK : PALETTE.faint });
  }, { padding: { top: 2, bottom: 2, start: 8, end: 8 }, ...(mine ? { background: PALETTE.brass } : {}) });
  if (!mine) frameRect(r);
}

/** A panel's title: brass serif. */
export function panelTitle(text: string): void {
  ui.label(text, { font: "serif", size: 16, weight: "600", color: PALETTE.brass });
}

/** Muted small print (the browser client's .panel-note / .play-hint). */
export function note(text: string): void {
  ui.label(text, { size: 12.5, color: PALETTE.faint });
}

/** A panel at `width` logical pixels with the room's 1-pixel line around it. */
export function framedPanel(id: string, width: number, build: () => void, spacing = 10): ui.Rect {
  const r = ui.panel(id, build, { padding: { top: 14, bottom: 14, start: 16, end: 16 }, spacing, width });
  frameRect(r);
  return r;
}

/** The room's 1-pixel line around a laid-out rectangle (window pixels). */
export function frameRect(r: ui.Rect, color: string = PALETTE.line): void {
  const s = frame().scale;
  const clip = currentClip();
  draw.strokeRoundRect(r.x - 0.5 * s, r.y - 0.5 * s, r.width + s, r.height + s, 6 * s, color, s, clip ? { clip } : {});
}

// -- Pictures ---------------------------------------------------------------------
let icon: ImageBitmap | null = null;
let keyArt: ImageBitmap | null = null;
let artFade: OffscreenCanvas | null = null;
createImageBitmap("icon.png").then((b) => { icon = b; }, () => { /* no mark */ });
createImageBitmap("assets/key-art.webp").then((b) => { keyArt = b; }, () => { /* plain room */ });

/** The landing's key art: the room behind the board, dimmed and fading into the floor. */
export function drawKeyArt(): void {
  if (!keyArt) return;
  const { width, height } = frame();
  const k = Math.max(width / keyArt.width, height / keyArt.height);
  const w = keyArt.width * k, h = keyArt.height * k;
  draw.image(keyArt, (width - w) / 2, (height - h) / 2, w, h, { tint: [1, 1, 1, 0.55] });
  if (!artFade) {
    artFade = new OffscreenCanvas(4, 256);
    const g = artFade.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "rgba(23,19,16,0.1)");
    grad.addColorStop(0.6, "rgba(23,19,16,0.45)");
    grad.addColorStop(1, "rgba(23,19,16,1)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  }
  draw.image(artFade, 0, 0, width, height);
}

// -- Top bar ------------------------------------------------------------------------

/** The top bar: the mark and wordmark, then (right) the rating, the sound
 * toggle and the runtime's settings. */
export function topBar(elo: number | null): void {
  const { width, scale, safeArea } = frame();
  const x0 = safeArea.left + 22 * scale, y0 = safeArea.top;
  const h = TOP_BAR * scale;
  draw.line(0, y0 + h, width, y0 + h, PALETTE.line, scale);
  if (icon) draw.image(icon, x0, y0 + 16 * scale, 22 * scale, 22 * scale);
  draw.text("STARHERMIT CHESS", x0 + 30 * scale, y0 + 20 * scale, { size: 13 * scale, font: "serif", color: PALETTE.muted, letterSpacing: 0.22 * 13 * scale });
  const narrow = width / scale < 560;
  const right = { x: width / 2, y: y0 + 11 * scale, width: width / 2 - safeArea.right - 22 * scale, height: 34 * scale };
  ui.area(right, () => {
    ui.row("top-right", () => {
      if (elo != null && !narrow) ui.label(`Elo ${elo}`, { font: "serif", size: 14, color: PALETTE.brass });
      if (ui.id("sound").button(soundOn() ? T("Sound on") : T("Sound off"), { size: 13, tone: soundOn() ? "accent" : "muted" })) toggleSound();
      if (ui.id("settings").button(narrow ? "⚙" : `⚙ ${T("Settings")}`, { size: 13 })) openMenu();
    }, { spacing: 12, align: "center", justify: "end", width: right.width / scale });
  });
}
