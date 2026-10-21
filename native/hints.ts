// One-time hints: the first times a player meets a mechanic (moving, castling,
// en passant, check, the correspondence clock) the table's side panel says
// how it works. A hint counts as seen once the player has moved while it was
// shown; seen hints are kept on the device.
import { storage } from "starhermit:storage";
import { T } from "./i18n.js";
import { rules, type Color, type GameState } from "./rules.js";

export type HintId = "move" | "check" | "enpassant" | "castle" | "online";

const KEY = "hints.seen";
let seen: Set<string> | null = null;

function seenSet(): Set<string> {
  if (!seen) {
    try { seen = new Set((storage.getJson(KEY) as string[] | null) ?? []); }
    catch { seen = new Set(); }
  }
  return seen;
}

export function markSeen(id: HintId): void {
  const s = seenSet();
  if (s.has(id)) return;
  s.add(id);
  try { storage.setJson(KEY, [...s]); } catch { /* shown again next time */ }
}

// translated:
const TEXT: Record<HintId, string> = {
  move: "Pick one of your pieces, then one of its dots to move it.",
  check: "Your king is in check: only moves that end the check are allowed.",
  enpassant: "En passant: a pawn that just moved two squares past yours can be taken as if it had moved one.",
  castle: "You can castle: pick your king and its dot two squares toward a rook; the rook jumps over it.",
  online: "You have 24 hours for each move. Leave whenever you like and come back from My games.",
};

export function hintText(id: HintId): string { return T(TEXT[id]); }

/** The hint for the position when it is `me`'s move (most specific first), or null. */
export function hintFor(g: GameState, me: Color, online: boolean): HintId | null {
  const s = seenSet();
  const want = (id: HintId): boolean => !s.has(id);
  if (want("check") && rules.inCheck(g.board, me)) return "check";
  if (want("enpassant") || want("castle")) {
    for (let i = 0; i < 64; i++) {
      const p = g.board[i]!;
      if (p === "." || rules.pieceColor(p) !== me || !"PpKk".includes(p)) continue;
      const moves = rules.legalMovesFrom(g, i);
      if (want("enpassant") && moves.some((m) => m.isEp)) return "enpassant";
      if (want("castle") && moves.some((m) => m.isCastle)) return "castle";
    }
  }
  if (want("move")) return "move";
  if (online && want("online")) return "online";
  return null;
}
