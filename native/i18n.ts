// Localization for the native client: the browser's own tables (strings.js),
// keyed by the English source string, in the locale the runtime reports.
import { onPreferencesChange, preferences } from "starhermit:engine";
import { loadClassic } from "starhermit:script";

loadClassic("strings.js");
const TABLES = (globalThis as unknown as { CH_STRINGS?: Record<string, Record<string, string>> }).CH_STRINGS ?? {};

const LOCALES = ["en-US", "en-GB", "es-419", "es-ES", "de-DE", "fr-FR", "fr-CA", "pt-BR", "it-IT"];
const PARENT: Record<string, string> = { "en-GB": "en-US", "es-ES": "es-419", "fr-CA": "fr-FR" };
const PRIMARY: Record<string, string> = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT" };

/** The supported locale nearest a BCP 47 tag. */
export function pickLocale(tag: string): string {
  const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  return PRIMARY[tag.split("-")[0]!.toLowerCase()] ?? "en-US";
}

export let locale = pickLocale(preferences().language);
onPreferencesChange((p) => { locale = pickLocale(p.language); });

/** Translates an English source string; `{name}` placeholders come from `vars`. */
export function T(key: string, vars?: Record<string, string | number>): string {
  let s = key;
  for (let l: string | undefined = locale; l; l = PARENT[l]) {
    const t = TABLES[l];
    if (t && Object.prototype.hasOwnProperty.call(t, key)) { s = t[key]!; break; }
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Why a game ended, e.g. "by checkmate". */
export function reasonText(reason: string | undefined): string {
  const reasons: Record<string, string> = {
    "checkmate": "by checkmate", "stalemate": "by stalemate",
    "threefold-repetition": "by threefold repetition", "fifty-move-rule": "by the fifty-move rule",
    "insufficient-material": "insufficient material", "resignation": "by resignation",
    "agreement": "by agreement", "timeout": "on time", "timeout-no-moves": "no moves were played",
    "abandoned": "abandoned", "players_left": "a player left",
  };
  return reason && reasons[reason] ? T(reasons[reason]!) : (reason ?? "");
}

/** "3h 12m" / "12m" for a time span in milliseconds. */
export function fmtLeft(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function colorName(color: string): string { return color === "black" ? T("black") : T("white"); }

// -- Screen-reader speech ---------------------------------------------------------
// translated:
const PIECE_NAMES = {
  K: "King", Q: "Queen", R: "Rook", B: "Bishop", N: "Knight",
};

/** A SAN move in words for a screen reader: "Knight takes e5, check". */
export function spokenMove(san: string): string {
  let s = san, tail = "";
  if (s.endsWith("#")) { s = s.slice(0, -1); tail = `, ${T("checkmate")}`; }
  else if (s.endsWith("+")) { s = s.slice(0, -1); tail = `, ${T("check")}`; }
  if (s.startsWith("O-O-O")) return T("long castling") + tail;
  if (s.startsWith("O-O")) return T("short castling") + tail;
  let promo = "";
  const eq = s.indexOf("=");
  if (eq >= 0) {
    const p = s[eq + 1] as keyof typeof PIECE_NAMES;
    promo = ` ${T("promotes to {piece}", { piece: T(PIECE_NAMES[p] ?? "Queen") })}`;
    s = s.slice(0, eq);
  }
  const first = s[0] as keyof typeof PIECE_NAMES;
  const piece = PIECE_NAMES[first] ? `${T(PIECE_NAMES[first])} ` : "";
  if (piece) s = s.slice(1);
  const words = s.split("x").join(` ${T("takes")} `);
  return `${piece}${words}${promo}${tail}`;
}

/** What a board square holds, for a screen reader: "e4, white pawn". */
export function spokenSquare(square: string, piece: string): string {
  if (piece === ".") return T("{square}, empty", { square });
  const names: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const color = piece === piece.toUpperCase() ? "white" : "black";
  return T(`{square}, ${color} ${names[piece.toLowerCase()]}`, { square });
}

// -- Achievements -------------------------------------------------------------------
// The platform lists achievements in the language server.js declares them in
// (English); these are the same texts for T().
// translated:
const ACHIEVEMENT_TEXT: Record<string, { name: string; description: string }> = {
  "first-win": { name: "First win", description: "Win a game." },
  "beat-hal": { name: "Beat hal", description: "Win a rated game against hal." },
  "checkmate": { name: "Checkmate", description: "Win a game by checkmate." },
  "promotion": { name: "Promoted", description: "Promote a pawn." },
  "en-passant": { name: "En passant", description: "Capture a pawn en passant." },
  "regular": { name: "Club regular", description: "Finish ten games." },
  "streak-3": { name: "On a roll", description: "Win three games in a row." },
  "rating-1400": { name: "Rising", description: "Reach a rating of 1400." },
  "fools-mate": { name: "Fool's mate", description: "Checkmate in two moves." },
};

/** An achievement's name and description in the player's language. */
export function achievementText(a: { key: string; name: string; description?: string }): { name: string; description: string } {
  const t = ACHIEVEMENT_TEXT[a.key];
  return t ? { name: T(t.name), description: T(t.description) } : { name: a.name, description: a.description ?? "" };
}

