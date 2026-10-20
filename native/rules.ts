// The chess rules for the native client: server.js itself, evaluated in the
// game's realm so legal-move highlights and replay stepping use the very code
// the platform referees with (its Node static-server tail is guarded off here).
import { loadClassic } from "starhermit:script";

export type Color = "white" | "black";

/** A legal move as `legalMovesFrom` gives it (square indices, a1 = 0). */
export interface Move {
  readonly from: number;
  readonly to: number;
  readonly promo?: string;
  readonly isEp?: boolean;
  readonly isCastle?: "K" | "Q";
}

/** A move in a game's log (server.js `makeMove`). */
export interface LoggedMove {
  readonly from: string;
  readonly to: string;
  readonly promo?: string | null;
  readonly san: string;
  readonly at?: number;
}

/** server.js `newGameState()`; only the fields the client reads are typed. */
export interface GameState {
  board: string;
  turn: Color;
  moves: LoggedMove[];
  status: "active" | "finished";
}

export interface MoveResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly san?: string;
  readonly gameOver?: { kind: string; reason: string };
}

interface ChessRules {
  newGameState(): GameState;
  legalMovesFrom(g: GameState, from: number): Move[];
  makeMove(g: GameState, req: { from: string; to: string; promo?: string | null }, now: number): MoveResult;
  inCheck(board: string, color: Color): boolean;
  pieceColor(p: string): Color | null;
  parseSquare(s: string): number;
  algebraic(i: number): string;
}

loadClassic("server.js");
export const rules = (globalThis as unknown as { chessRules: ChessRules }).chessRules;

/** The king's square of `color` when it is in check, else -1. */
export function checkSquare(g: GameState): number {
  if (!rules.inCheck(g.board, g.turn)) return -1;
  return g.board.indexOf(g.turn === "white" ? "K" : "k");
}

/** One position of a game being stepped through. */
export interface Position {
  readonly board: string;
  readonly turn: Color;
  readonly check: number;
  readonly last: { from: number; to: number } | null;
}

/** Rebuilds a game from its move log: the final state (castling and en-passant
 * rights included, which a bare board cannot carry) and every position on the way. */
export function replayMoves(moves: readonly LoggedMove[]): { game: GameState; positions: Position[] } {
  const g = rules.newGameState();
  const positions: Position[] = [{ board: g.board, turn: g.turn, check: -1, last: null }];
  for (const m of moves) {
    const res = rules.makeMove(g, { from: m.from, to: m.to, promo: m.promo ?? null }, m.at ?? 0);
    if (!res.ok) break;
    positions.push({
      board: g.board,
      turn: g.turn,
      check: checkSquare(g),
      last: { from: rules.parseSquare(m.from), to: rules.parseSquare(m.to) },
    });
  }
  return { game: g, positions };
}
