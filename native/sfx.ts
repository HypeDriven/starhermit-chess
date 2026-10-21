// Sound effects: one sfx/*.opus clip per game event, through the
// engine's mixer (volume lives in the runtime's Options › Audio).
import { context, loadClip, play as playClip, type AudioClip } from "starhermit:audio";

const FILES = {
  select: "piece-select", move: "piece-move", capture: "piece-capture", castle: "piece-castle",
  promote: "promote-chime", check: "check-bell", illegal: "illegal-knock", matchFound: "match-found",
  drawOffer: "draw-offer", chat: "chat-note", clockWarning: "clock-warning",
  win: "game-win", lose: "game-lose", draw: "game-draw",
} as const;
export type SfxName = keyof typeof FILES;

const clips = new Map<SfxName, AudioClip>();
/** Long enough for the web runtime to finish one clip's upload (about 150 ms). */
const UPLOAD_GAP_MS = 400;

/** Loads every clip once the mixer runs, one at a time and spaced out; a clip
 * that fails to decode just stays silent. On the web runtime the mixer starts
 * with the player's first press, and engines 1.3.0–1.4.0 there silently lose clips
 * made before it or uploaded side by side (all but one or two). */
export function loadSfx(): void {
  const wait = (): void => { if (context.currentTime > 0) void loadAll(); else setTimeout(wait, 250); };
  wait();
}

async function loadAll(): Promise<void> {
  for (const [name, file] of Object.entries(FILES)) {
    try { clips.set(name as SfxName, await loadClip(`sfx/${file}.opus`)); }
    catch (e) { console.warn(`sfx ${file}: ${String(e)}`); }
    await new Promise<void>((resolve) => setTimeout(resolve, UPLOAD_GAP_MS));
  }
}

export function sfx(name: SfxName): void {
  const clip = clips.get(name);
  if (!clip) return;
  try {
    playClip(clip, { bus: name === "select" || name === "illegal" ? "interface" : "effects" });
  } catch {
    // The web runtime can lose clips decoded before the page's audio started
    // (the first press): load this one again for next time.
    clips.delete(name);
    loadClip(`sfx/${FILES[name]}.opus`).then((c) => { clips.set(name, c); }, () => { /* stays silent */ });
  }
}

/** The sound for a move from its SAN, plus the check bell. */
export function sfxForMove(san: string): void {
  if (san.startsWith("O-O")) sfx("castle");
  else if (san.includes("=")) sfx("promote");
  else if (san.includes("x")) sfx("capture");
  else sfx("move");
  if (/[+#]$/.test(san)) sfx("check");
}
