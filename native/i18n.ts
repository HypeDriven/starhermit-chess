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
    "abandoned": "abandoned",
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
