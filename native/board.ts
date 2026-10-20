// The board: squares, markers and pieces drawn into the overlay, hit-testing
// for clicks and taps, and the keyboard/gamepad focus square. The piece art is
// the browser's (ui.js UI.PIECE): one 45 x 45 grid, rasterized per size.
import * as draw from "starhermit:draw";
import { OffscreenCanvas, Path2D, type ImageBitmap } from "starhermit:canvas";
import { rules, type Color } from "./rules.js";

export const PALETTE = {
  bg: "#171310", panel: "#201a15", panel2: "#29211a", line: "#3a2f24", ink: "#ece1cc",
  muted: "#a4926f", faint: "#6f6250", brass: "#c8a35f", brassHi: "#e2c17e",
  light: "#d5bd92", dark: "#7c5a3e", ok: "#8caf78", danger: "#c9674f",
};

const PLINTH = "M11 34.5h23l1.5 4h-26z";
interface Art { fill: string[]; dot?: [number, number, number][]; line?: string[]; lineColor?: boolean }
const ART: Record<string, Art> = {
  p: { fill: ["M22.5 7.6a5.4 5.4 0 0 1 3.8 9.2c-.7 1.2-.6 2.3.2 3.8 1.8 3.9 4.2 8.6 4.2 13.9"
    + "h-16.4c0-5.3 2.4-10 4.2-13.9.8-1.5.9-2.6.2-3.8a5.4 5.4 0 0 1 3.8-9.2z"] },
  r: { fill: ["M11 10h5v3.2h4.2V10h4.6v3.2H29V10h5v6.5l-2.8 2.5v11.5l2.3 4h-22l2.3-4V19L11 16.5z"] },
  n: {
    fill: ["M14 34.5C14.4 30.1 15.5 27.1 17.6 24.7 15.5 24.5 12.6 23.9 11.1 22.4"
      + " 10 21.3 10.3 19.8 11.6 17.9 13.3 15.5 15.6 13.7 17.6 11.5 19.2 10.4 20.4 9 20.8 7.2"
      + "L23 9.4 25 4.6 26.3 9.6C28.8 11.2 30.5 13.5 31.2 16.8 31.8 19.8 32.1 23.6 32.1 27.6"
      + "L32.1 34.5Z"],
    dot: [[15.6, 17.3, 1.2]],
    lineColor: true,
  },
  b: {
    fill: ["M22.5 4.6a2.6 2.6 0 0 1 1.9 4.4c3.4 2.6 5.9 6.9 5.9 11.1 0 3.4-2.1 5.9-3.9 7.6"
      + "-1 1-1.6 1.8-1.9 2.8h4l2.7 4h-17.4l2.7-4h4c-.3-1-.9-1.8-1.9-2.8-1.8-1.7-3.9-4.2-3.9-7.6"
      + " 0-4.2 2.5-8.5 5.9-11.1a2.6 2.6 0 0 1 1.9-4.4z"],
    line: ["M19.5 19.5L25.2 13.4"],
  },
  q: {
    fill: ["M10.5 11.5L13.5 17.5 16.5 8.5 19.5 17.5 22.5 6.5 25.5 17.5 28.5 8.5 31.5 17.5"
      + " 34.5 11.5 33.8 21.5C34.3 26 33 29.5 31.8 32L32.5 34.5H12.5L13.2 32C12 29.5 10.7 26"
      + " 11.2 21.5Z"],
    dot: [[10.5, 11.5, 2.2], [16.5, 8.5, 2.2], [22.5, 6.5, 2.4], [28.5, 8.5, 2.2], [34.5, 11.5, 2.2]],
  },
  k: {
    fill: ["M21 3.5h3v3.5h3.5v3H24v4h-3v-4h-3.5v-3H21z",
      "M22.5 12.5c-4.3 0-7.5 2.8-7.5 6.4 0 2 .9 3.6 2 5-3.2-1.6-7.5-1-7.5 2.8 0 3 3.3 5 6.5 5.8"
      + "l-1.5 2h16l-1.5-2c3.2-.8 6.5-2.8 6.5-5.8 0-3.8-4.3-4.4-7.5-2.8 1.1-1.4 2-3 2-5"
      + " 0-3.6-3.2-6.4-7.5-6.4z"],
  },
};

let cacheSize = 0;
const cache = new Map<string, ImageBitmap>();

/** A board character's piece ('Q' white, 'q' black) at `size` pixels. */
export function pieceImage(ch: string, size: number): ImageBitmap {
  size = Math.max(8, Math.round(size));
  if (size !== cacheSize) {
    for (const b of cache.values()) b.close();
    cache.clear();
    cacheSize = size;
  }
  let img = cache.get(ch);
  if (img) return img;
  const white = ch === ch.toUpperCase();
  const body = white ? "#f6ecd8" : "#26190f";
  const outline = white ? "#2a1c10" : "#e7dbc0";
  const art = ART[ch.toLowerCase()]!;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.scale(size / 45, size / 45);
  ctx.shadowColor = white ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.35)";
  ctx.shadowOffsetY = 1;
  ctx.shadowBlur = 1;
  ctx.fillStyle = body;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  const shape = (p: Path2D, fill: string | null, width: number) => {
    if (fill) { ctx.fillStyle = fill; ctx.fill(p); }
    if (width) { ctx.lineWidth = width; ctx.stroke(p); }
  };
  for (const d of [...art.fill, PLINTH]) shape(new Path2D(d), body, 1.5);
  for (const [cx, cy, r] of art.dot ?? []) {
    const p = new Path2D();
    p.arc(cx, cy, r, 0, Math.PI * 2);
    if (art.lineColor) shape(p, outline, 0); else shape(p, body, 1.5);
  }
  for (const d of art.line ?? []) shape(new Path2D(d), null, 1.3);
  img = canvas.transferToImageBitmap();
  cache.set(ch, img);
  return img;
}

export interface Rect { x: number; y: number; width: number; height: number }

export interface BoardView {
  readonly board: string;
  readonly flipped: boolean;
  readonly selected?: number;
  readonly dests?: readonly { to: number; cap: boolean }[];
  readonly last?: { from: number; to: number } | null;
  readonly check?: number;
  /** The keyboard/gamepad focus square, drawn as a ring. */
  readonly focus?: number | null;
}

/** Where square `i` is drawn. */
function cell(rect: Rect, flipped: boolean, i: number): Rect {
  const s = rect.width / 8;
  const file = i % 8, rank = (i - file) / 8;
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  return { x: rect.x + col * s, y: rect.y + row * s, width: s, height: s };
}

/** The square under a window point, or -1. */
export function squareAt(rect: Rect, flipped: boolean, x: number, y: number): number {
  const s = rect.width / 8;
  const col = Math.floor((x - rect.x) / s), row = Math.floor((y - rect.y) / s);
  if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
  const file = flipped ? 7 - col : col;
  const rank = flipped ? row : 7 - row;
  return rank * 8 + file;
}

export function drawBoard(rect: Rect, v: BoardView, scale: number): void {
  draw.rect(rect.x - 4 * scale, rect.y - 4 * scale, rect.width + 8 * scale, rect.height + 8 * scale, PALETTE.line);
  const coordSize = Math.max(9, rect.width / 8 * 0.16);
  for (let i = 0; i < 64; i++) {
    const c = cell(rect, v.flipped, i);
    const file = i % 8, rank = (i - file) / 8;
    const light = (file + rank) % 2 === 1;
    draw.rect(c.x, c.y, c.width, c.height, light ? PALETTE.light : PALETTE.dark);
    if (v.last && (v.last.from === i || v.last.to === i)) draw.rect(c.x, c.y, c.width, c.height, [0.886, 0.757, 0.494, 0.3]);
    if (v.check === i) draw.roundRect(c.x, c.y, c.width, c.height, c.width / 2, [0.788, 0.404, 0.31, 0.75]);
    if (v.selected === i) draw.strokeRect(c.x, c.y, c.width, c.height, PALETTE.brass, 3 * scale);
    const coordColor = light ? "rgba(28,21,14,0.55)" : "rgba(236,225,204,0.55)";
    const bottomRow = v.flipped ? rank === 7 : rank === 0;
    const leftCol = v.flipped ? file === 7 : file === 0;
    if (bottomRow) draw.text("abcdefgh"[file]!, c.x + c.width * 0.96, c.y + c.height * 0.96 - coordSize, { size: coordSize, color: coordColor, align: "end" });
    if (leftCol) draw.text(String(rank + 1), c.x + c.width * 0.05, c.y + c.height * 0.04, { size: coordSize, color: coordColor });
    const p = v.board[i]!;
    if (p !== ".") draw.image(pieceImage(p, c.width), c.x, c.y, c.width, c.height);
  }
  for (const d of v.dests ?? []) {
    const c = cell(rect, v.flipped, d.to);
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
    if (d.cap) {
      const r = c.width * 0.44;
      draw.strokeRoundRect(cx - r, cy - r, r * 2, r * 2, r, "rgba(28,21,14,0.4)", 3 * scale);
    } else {
      const r = c.width * 0.13;
      draw.roundRect(cx - r, cy - r, r * 2, r * 2, r, "rgba(28,21,14,0.36)");
    }
  }
  if (v.focus != null && v.focus >= 0) {
    const c = cell(rect, v.flipped, v.focus);
    draw.strokeRect(c.x + 2 * scale, c.y + 2 * scale, c.width - 4 * scale, c.height - 4 * scale, PALETTE.brassHi, 2 * scale);
  }
}

/** Moves the focus square by board-relative steps (as the player sees it). */
export function moveFocus(focus: number, flipped: boolean, dCol: number, dRow: number): number {
  const file = focus % 8, rank = (focus - file) / 8;
  const df = flipped ? -dCol : dCol, dr = flipped ? dRow : -dRow;
  const f = Math.min(7, Math.max(0, file + df)), r = Math.min(7, Math.max(0, rank + dr));
  return r * 8 + f;
}

/** The square name a screen reader or label uses, e.g. "e4". */
export function squareName(i: number): string { return rules.algebraic(i); }

export function sideOf(p: string): Color | null { return rules.pieceColor(p); }
