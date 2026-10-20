// Sound effects: the same sfx/*.opus clips the browser plays, through the
// engine's mixer (volume lives in the runtime's Options › Audio).
import { loadClip, play as playClip, type AudioClip } from "starhermit:audio";

const FILES = {
  select: "piece-select", move: "piece-move", capture: "piece-capture", castle: "piece-castle",
  promote: "promote-chime", check: "check-bell", illegal: "illegal-knock", matchFound: "match-found",
  drawOffer: "draw-offer", chat: "chat-note", clockWarning: "clock-warning",
  win: "game-win", lose: "game-lose", draw: "game-draw",
} as const;
export type SfxName = keyof typeof FILES;

const clips = new Map<SfxName, AudioClip>();

/** Loads every clip; a clip that fails to decode just stays silent. */
export async function loadSfx(): Promise<void> {
  await Promise.all(Object.entries(FILES).map(async ([name, file]) => {
    try { clips.set(name as SfxName, await loadClip(`sfx/${file}.opus`)); }
    catch (e) { console.warn(`sfx ${file}: ${String(e)}`); }
  }));
}

export function sfx(name: SfxName): void {
  const clip = clips.get(name);
  if (clip) playClip(clip, { bus: name === "select" || name === "illegal" ? "interface" : "effects" });
}

/** The sound for a move from its SAN, plus the check bell. */
export function sfxForMove(san: string): void {
  if (san.startsWith("O-O")) sfx("castle");
  else if (san.includes("=")) sfx("promote");
  else if (san.includes("x")) sfx("capture");
  else sfx("move");
  if (/[+#]$/.test(san)) sfx("check");
}
