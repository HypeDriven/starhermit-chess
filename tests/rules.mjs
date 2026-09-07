/**
 * StarHermit Chess — rules + server-script checks (dev only, not shipped).
 *
 * server.js is the authoritative game script: the platform runs it in a
 * sandbox, and the browser client loads the same file for move highlighting.
 * This test loads it the way the browser does — as a plain script with no
 * `require` in scope, so its optional local-static-server tail stays dormant —
 * and exercises the rules directly plus the `globalThis.game` entry points.
 *
 *   node tests/rules.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// eslint-disable-next-line no-new-func
new Function(await readFile(path.join(ROOT, 'server.js'), 'utf8'))();

const R = globalThis.chessRules;
const GAME = globalThis.game;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL - ' + name + '\n  ' + (e && e.message));
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function ok(cond, what) { if (!cond) throw new Error(what || 'expected truthy'); }

const idx = (s) => '12345678'.indexOf(s[1]) * 8 + 'abcdefgh'.indexOf(s[0]);
const clone = (g) => JSON.parse(JSON.stringify(g));

/** A bare position: `map` is {'a1':'K', ...}; everything else is a clean slate. */
function stateFrom(map, turn) {
  const g = R.newGameState();
  const b = '.'.repeat(64).split('');
  for (const s of Object.keys(map)) b[idx(s)] = map[s];
  g.board = b.join('');
  g.turn = turn;
  g.castling = { K: false, Q: false, k: false, q: false };
  g.epSquare = -1;
  g.positionCounts = {};
  return g;
}

/** Play a list of coordinate moves, asserting each is accepted. */
function play(g, moves) {
  const sans = [];
  for (const mv of moves) {
    const res = R.makeMove(g, { from: mv.slice(0, 2), to: mv.slice(2, 4), promo: mv[4] }, 0);
    if (!res.ok) throw new Error(`${mv} rejected: ${res.error}`);
    sans.push(res.san);
    if (res.gameOver) return { sans, gameOver: res.gameOver };
  }
  return { sans, gameOver: null };
}

// ---------------------------------------------------------------- move generation
check('perft(1..3) from the opening position', () => {
  const perft = (g, depth) => {
    const moves = R.allLegalMoves(g);
    if (depth === 1) return moves.length;
    let n = 0;
    for (const m of moves) {
      const next = clone(g);
      const res = R.makeMove(next, {
        from: R.algebraic(m.from), to: R.algebraic(m.to), promo: m.promo || undefined,
      }, 0);
      if (!res.ok) throw new Error('legal move rejected by makeMove: ' + JSON.stringify(m));
      n += perft(next, depth - 1);
    }
    return n;
  };
  eq(perft(R.newGameState(), 1), 20, 'perft(1)');
  eq(perft(R.newGameState(), 2), 400, 'perft(2)');
  eq(perft(R.newGameState(), 3), 8902, 'perft(3)');
});

check('castling, en passant and promotion are playable and scored', () => {
  // 1.e4 d5 2.Nf3 dxe4 3.Ng5 Nf6 4.Bc4 e6 5.O-O — kingside castling
  const g = R.newGameState();
  const { sans } = play(g, ['e2e4', 'd7d5', 'g1f3', 'd5e4', 'f3g5', 'g8f6', 'f1c4', 'e7e6', 'e1g1']);
  eq(sans[3], 'dxe4', 'pawn capture SAN');
  eq(sans[8], 'O-O', 'castling SAN');
  eq(g.board[idx('g1')], 'K', 'king landed on g1');
  eq(g.board[idx('f1')], 'R', 'rook landed on f1');

  // en passant: black's double push is captured behind the target square
  const ep = stateFrom({ e1: 'K', e8: 'k', e5: 'P', d7: 'p' }, 'black');
  play(ep, ['d7d5']);
  eq(ep.epSquare, idx('d6'), 'en-passant target');
  const res = R.makeMove(ep, { from: 'e5', to: 'd6' }, 0);
  ok(res.ok, 'en passant should be legal: ' + res.error);
  eq(ep.board[idx('d5')], '.', 'captured pawn removed');
  eq(res.san, 'exd6', 'en passant SAN');

  // promotion requires a piece, and produces it
  const pr = stateFrom({ e1: 'K', e8: 'k', b7: 'P' }, 'white');
  eq(R.makeMove(clone(pr), { from: 'b7', to: 'b8' }, 0).error,
    'Promotion piece required (q, r, b or n).', 'missing promo piece');
  const pres = R.makeMove(pr, { from: 'b7', to: 'b8', promo: 'q' }, 0);
  ok(pres.ok, 'promotion should be legal');
  eq(pr.board[idx('b8')], 'Q', 'promoted piece');
  eq(pres.san, 'b8=Q+', 'promotion SAN');
});

// ---------------------------------------------------------------- SAN
check('SAN disambiguates by file, by rank, and by both', () => {
  // two knights on different files reaching d2 -> file
  const byFile = stateFrom({ e1: 'K', e8: 'k', f3: 'N', b1: 'N' }, 'white');
  eq(R.makeMove(byFile, { from: 'f3', to: 'd2' }, 0).san, 'Nfd2', 'file hint');

  // two rooks on the same file reaching a3 -> rank
  const byRank = stateFrom({ e1: 'K', e8: 'k', a1: 'R', a5: 'R' }, 'white');
  eq(R.makeMove(byRank, { from: 'a1', to: 'a3' }, 0).san, 'R1a3', 'rank hint');

  // three queens reaching d3, one sharing the file and one the rank -> square
  const bySquare = stateFrom({ e1: 'K', e8: 'k', a3: 'Q', d6: 'Q', a6: 'Q' }, 'white');
  eq(R.makeMove(bySquare, { from: 'a6', to: 'd3' }, 0).san, 'Qa6d3', 'full-square hint');

  // an unambiguous move carries no hint at all
  const plain = stateFrom({ e1: 'K', e8: 'k', c3: 'N' }, 'white');
  eq(R.makeMove(plain, { from: 'c3', to: 'd5' }, 0).san, 'Nd5', 'no hint');
});

// ---------------------------------------------------------------- draws
check('threefold repetition counts the opening position', () => {
  // Two knight round-trips bring the start position back for the third time.
  const g = R.newGameState();
  const out = play(g, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  ok(out.gameOver, 'the eighth ply should end the game');
  eq(out.gameOver.kind, 'draw', 'result kind');
  eq(out.gameOver.reason, 'threefold-repetition', 'result reason');
});

check('checkmate, stalemate and insufficient material are detected', () => {
  const mate = R.newGameState();
  const foolsMate = play(mate, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  eq(foolsMate.gameOver && foolsMate.gameOver.reason, 'checkmate', 'fool\'s mate');
  eq(foolsMate.gameOver.kind, 'black', 'mate winner');
  eq(foolsMate.sans[3], 'Qh4#', 'mate SAN');

  // Ka6 covers a7/b7, the rook arriving on b1 covers b8: black is not in check
  // and has no move at all.
  const stale = stateFrom({ a8: 'k', a6: 'K', h1: 'R' }, 'white');
  const sres = R.makeMove(stale, { from: 'h1', to: 'b1' }, 0);
  eq(sres.gameOver && sres.gameOver.reason, 'stalemate', 'stalemate');

  const bare = stateFrom({ e1: 'K', e8: 'k', d5: 'N', e5: 'p' }, 'white');
  const bres = R.makeMove(bare, { from: 'd5', to: 'e7' }, 0);
  ok(!bres.gameOver, 'K+N vs K+P is still a game');
  const kn = stateFrom({ e1: 'K', e8: 'k', d5: 'N', c7: 'p' }, 'white');
  const kres = R.makeMove(kn, { from: 'd5', to: 'c7' }, 0);
  eq(kres.gameOver && kres.gameOver.reason, 'insufficient-material', 'K+N vs K');
});

// ---------------------------------------------------------------- entry points
check('a game hal ends still publishes ratings and records', () => {
  const human = 'human-1', hal = 'hal-1';
  // White (the human) hangs the queen on d1; black's only capture is mate.
  const g = stateFrom({ a1: 'K', a2: 'P', b2: 'P', d2: 'Q', h8: 'k', d8: 'r' }, 'white');
  const s = {
    white: human, black: hal, aiId: hal, game: g,
    createdAt: 0, deadline: 10, result: null, drawOfferBy: null,
  };
  const ctx = {
    now: 1, random: 0.5, sessionId: 'sess-1',
    players: [{ id: human }, { id: hal, ai: true }],
    sessionState: s,
    playerStates: {},
    message: { from: human, data: { type: 'move', from: 'd2', to: 'd1' } },
  };
  const out = GAME.onPlayerMessage(ctx);
  ok(out.ok, 'move should be accepted: ' + out.error);
  eq(s.game.moves.length, 2, 'hal replied');
  eq(s.game.moves[1].san, 'Rxd1#', 'hal mates');
  eq(out.result && out.result.kind, 'black', 'hal wins');
  ok(out.eloUpdates, 'eloUpdates must leave with the invocation');
  ok(out.playerStates && out.playerStates[human] && out.playerStates[hal],
    'both player documents must be persisted');
  ok(out.eloUpdates[hal] > 1200, 'hal gained rating');
  ok(out.eloUpdates[human] < 1200, 'the human lost rating');
  eq(out.playerStates[human].losses, 1, 'human loss recorded');
  eq(out.playerStates[hal].wins, 1, 'hal win recorded');
});

check('resignation, draw agreement and the move deadline end a game', () => {
  const a = 'p-a', b = 'p-b';
  const mk = (msgFrom, data) => ({
    now: 1000, random: 0.25, sessionId: 'sess-2',
    players: [{ id: a }, { id: b }],
    sessionState: {
      white: a, black: b, game: R.newGameState(),
      createdAt: 0, deadline: 500, result: null, drawOfferBy: null,
    },
    playerStates: {},
    message: { from: msgFrom, data },
  });

  const resign = mk(a, { type: 'resign' });
  const rout = GAME.onPlayerMessage(resign);
  eq(rout.result.kind, 'black', 'resigning hands the win over');
  ok(rout.eloUpdates[b] > rout.eloUpdates[a], 'the winner rates above the loser');

  const offer = mk(a, { type: 'offer-draw' });
  ok(GAME.onPlayerMessage(offer).ok, 'draw offer accepted');
  eq(offer.sessionState.drawOfferBy, 'white', 'offer recorded');
  offer.message = { from: b, data: { type: 'accept-draw' } };
  const dout = GAME.onPlayerMessage(offer);
  eq(dout.result.kind, 'draw', 'draw agreed');
  eq(dout.result.reason, 'agreement', 'draw reason');

  // A player who is not in the session is refused outright.
  const stranger = mk('nobody', { type: 'resign' });
  eq(GAME.onPlayerMessage(stranger).ok, false, 'strangers cannot command');

  // Deadline passed with no move played at all: a draw, not a loss.
  const tick = mk(a, { type: 'sync' });
  const tout = GAME.onTick(tick);
  eq(tout.result.reason, 'timeout-no-moves', 'unplayed game times out as a draw');
  eq(tout.result.kind, 'draw', 'unplayed timeout kind');

  // Deadline passed after a move: the player on the clock loses.
  const late = mk(a, { type: 'sync' });
  play(late.sessionState.game, ['e2e4']);
  const lout = GAME.onTick(late);
  eq(lout.result.reason, 'timeout', 'timeout reason');
  eq(lout.result.kind, 'white', 'black was on the clock and lost');
});

check('a client cannot move out of turn or play an illegal move', () => {
  const a = 'p-a', b = 'p-b';
  const ctx = {
    now: 1, random: 0.5, sessionId: 'sess-3',
    players: [{ id: a }, { id: b }],
    sessionState: {
      white: a, black: b, game: R.newGameState(),
      createdAt: 0, deadline: 1e12, result: null, drawOfferBy: null,
    },
    playerStates: {},
    message: { from: b, data: { type: 'move', from: 'e7', to: 'e5' } },
  };
  eq(GAME.onPlayerMessage(ctx).error, 'Not your turn.', 'black cannot open');
  ctx.message = { from: a, data: { type: 'move', from: 'e2', to: 'e5' } };
  eq(GAME.onPlayerMessage(ctx).error, 'Illegal move.', 'three-square pawn push');
  ctx.message = { from: a, data: { type: 'move', from: 'zz', to: '99' } };
  eq(GAME.onPlayerMessage(ctx).error, 'Malformed square.', 'garbage squares');
  ctx.message = { from: a, data: { type: 'launch-nukes' } };
  eq(GAME.onPlayerMessage(ctx).ok, false, 'unknown commands are refused');
  eq(ctx.sessionState.game.moves.length, 0, 'nothing was recorded');
});

check('colours alternate between the same pair, and the manifest knobs are declared', () => {
  const a = 'p-a', b = 'p-b';
  const mk = (random) => ({
    now: 1, random, sessionId: 'sess-4',
    players: [{ id: a }, { id: b }],
    sessionState: null, playerStates: {},
  });
  const first = mk(0.1);
  const f = GAME.createSession(first);
  const firstWhite = f.sessionState.white;
  const second = mk(0.9);
  second.playerStates = f.playerStates;
  const s = GAME.createSession(second);
  ok(s.sessionState.white !== firstWhite, 'the second game swaps colours');
  const third = mk(0.9);
  third.playerStates = s.playerStates;
  eq(GAME.createSession(third).sessionState.white, firstWhite, 'and the third swaps back');

  eq(GAME.tickRateHz, 1, 'tick rate declared');
  eq(GAME.replays, true, 'replays requested');
  eq(GAME.createSession({ ...mk(0.5), players: [{ id: a }] }).ok, false, 'chess needs two players');
});

console.log(failures ? `\n${failures} check(s) FAILED` : '\nRULES PASS — all checks clean');
process.exit(failures ? 1 : 0);
