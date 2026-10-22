// The club room's look, as the browser client drew it (style.css): brass on
// walnut, serif headings, framed panels and cards with a 1-pixel line, a top
// bar with the wordmark. The rules are ui.setStyles classes, CSS for CSS.
import { createImageBitmap, OffscreenCanvas, type ImageBitmap } from "starhermit:canvas";
import { frame, openMenu } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { PALETTE } from "./board.js";
import { T } from "./i18n.js";
import { TOP_BAR } from "./shell.js";
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

const STYLES: { [key: string]: ui.Style } = {
  // .btn: walnut with a line that turns brass under the pointer.
  button: {
    background: PALETTE.panel2,
    border: { width: 1, color: PALETTE.line },
    radius: 6,
    padding: { top: 8, bottom: 8, start: 16, end: 16 },
    hovered: { border: { color: PALETTE.brass } },
    pressed: { translate: { y: 1 } },
    disabled: { opacity: 0.45, border: { color: PALETTE.line } },
    focusRing: { color: PALETTE.brass, width: 2, offset: 2 },
  },
  ".primary": {
    background: PALETTE.brass,
    border: { color: PALETTE.brass },
    text: { color: BRASS_INK, weight: "600" },
    hovered: { background: PALETTE.brassHi, border: { color: PALETTE.brassHi } },
    disabled: { border: { color: PALETTE.brass } },
  },
  ".danger": {
    background: "transparent",
    border: { color: "#c9674f80" },
    text: { color: PALETTE.danger },
    hovered: { border: { color: PALETTE.danger } },
  },
  ".small": { padding: { top: 4, bottom: 4, start: 11, end: 11 }, text: { size: 13 } },
  ".big": { padding: { top: 12, bottom: 12, start: 44, end: 44 }, text: { size: 18, font: "serif", letterSpacing: "0.04em" } },
  ".wide": { width: "fill", text: { align: "center" } },
  // .panel
  ".framed": {
    background: PALETTE.panel,
    border: { width: 1, color: PALETTE.line },
    radius: 6,
    padding: { top: 14, bottom: 14, start: 16, end: 16 },
  },
  // .auth-card: the landing's card, lifted off the key art.
  ".seat": { extends: ".framed", padding: 28, shadow: { y: 10, blur: 30, color: "#00000073" } },
  // .card; .cards-tight .card in the side column.
  ".card": {
    background: PALETTE.panel2,
    border: { width: 1, color: PALETTE.line },
    radius: 6,
    padding: { top: 10, bottom: 10, start: 14, end: 14 },
    hoverWithin: { border: { color: PALETTE.brass } },
  },
  ".card-tight": { extends: ".card", padding: { top: 7, bottom: 7, start: 11, end: 11 } },
  // .card-name: the card's name, a button that is only its text.
  ".card-name": {
    background: "transparent",
    border: { width: 0 },
    padding: 0,
    text: { font: "serif", size: 16, color: PALETTE.ink },
    hovered: { text: { color: PALETTE.brassHi } },
  },
  // .card-turn, .card-turn.mine
  ".pill": {
    radius: 10,
    border: { width: 1, color: PALETTE.line },
    padding: { top: 2, bottom: 2, start: 8, end: 8 },
    text: { size: 11, letterSpacing: "0.1em", transform: "uppercase", color: PALETTE.faint },
  },
  ".pill-mine": { extends: ".pill", background: PALETTE.brass, border: { color: PALETTE.brass }, text: { color: BRASS_INK, weight: "600" } },
  // .auth-local-hint
  ".hint": { text: { size: 13, color: PALETTE.faint, align: "center" }, width: "fill" },
  // .auth-divider
  ".divider": { text: { size: 11, letterSpacing: "0.12em", transform: "uppercase", color: PALETTE.faint, align: "center" }, width: "fill" },
  // .msg, .msg.mine
  ".msg": {
    background: PALETTE.panel2,
    border: { width: 1, color: PALETTE.line },
    radius: 10,
    padding: { top: 6, bottom: 6, start: 10, end: 10 },
  },
  ".msg-mine": { extends: ".msg", background: "#c8a35f24", border: { color: "#c8a35f66" } },
  // .chat-form input
  textField: {
    background: PALETTE.bg,
    border: { width: 1, color: PALETTE.line },
    radius: 6,
    focused: { border: { color: PALETTE.brass } },
  },
};

export function setTheme(): void {
  ui.setTheme(THEME);
  ui.setStyles(STYLES);
}

/** The filled brass button (Play): `big` is the menu's large serif one,
 * `wide` fills its column. */
export function primaryButton(id: string, label: string, options: { big?: boolean; wide?: boolean; disabled?: boolean } = {}): boolean {
  return ui.id(id).style("primary", !!options.big && "big", !!options.wide && "wide").button(label, { disabled: !!options.disabled });
}

/** A small secondary button (.btn-small). */
export function smallButton(id: string, label: string): boolean {
  return ui.id(id).style("small").button(label);
}

/** A card's name, as a button that is only its serif text. */
export function cardButton(id: string, label: string): boolean {
  return ui.id(id).style("card-name").button(label);
}

/** The small turn pill on a game card: brass when it is the player's move. */
export function pill(id: string, text: string, mine: boolean): void {
  ui.id(id).style(mine ? "pill-mine" : "pill").label(text);
}

/** A panel's title: brass serif. */
export function panelTitle(text: string): void {
  ui.label(text, { font: "serif", size: 16, weight: "600", color: PALETTE.brass });
}

/** Muted small print (the browser client's .panel-note / .play-hint). */
export function note(text: string): void {
  ui.label(text, { size: 12.5, color: PALETTE.faint });
}

/** A panel at `width` logical pixels with the room's 1-pixel line around it
 * (.panel; `seat` is the landing's .auth-card). */
export function framedPanel(id: string, width: number, build: () => void, spacing = 10, seat = false): ui.Rect {
  return ui.panel(id, build, { style: seat ? "seat" : "framed", spacing, width });
}

/** Takes the free width of a fixed-width row (CSS's `.spacer { flex: 1 }`):
 * what follows sits at the row's end. */
export function spacer(id: string): void {
  ui.column(id, () => { /* empty */ }, { grow: 1 });
}

/** Small capitals between two rules across `width` (.auth-divider). */
export function divider(id: string, text: string, width: number): void {
  // Window pixels; the letter spacing (0.12em) is not measured.
  const s = frame().scale;
  const m = ui.measureText(text.toUpperCase(), { size: 11 });
  const textW = m.width / s + [...text].length * 11 * 0.12;
  const rule = Math.max(0, (width - textW) / 2 - 12);
  const top = Math.round(m.height / s / 2);
  ui.id(id).style("divider", {
    decorations: [
      { fill: PALETTE.line, start: 0, top, width: rule, height: 1 },
      { fill: PALETTE.line, end: 0, top, width: rule, height: 1 },
    ],
  }).label(text);
}

/** A card: a raised row in a panel (.card; `tight` in the side column). */
export function card(id: string, width: number, build: () => void, tight = false): ui.Rect {
  return ui.row(id, build, { style: tight ? "card-tight" : "card", spacing: tight ? 8 : 12, align: "center", width });
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
      if (ui.id("sound").style("small").button(soundOn() ? T("Sound on") : T("Sound off"), { selected: soundOn() })) toggleSound();
      if (ui.id("settings").style("small").button(narrow ? "⚙" : `⚙ ${T("Settings")}`)) openMenu();
    }, { spacing: 12, align: "center", justify: "end", width: right.width / scale });
  });
}
