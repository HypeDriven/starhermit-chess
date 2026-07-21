// =============================================================================
// starhermit-chess/server.js — the single authoritative game-server script for Chess.
//
// This file is uploaded to the starhermit platform as the game's server script
// and executed inside the platform's sandboxed GameScriptHost (Jint). It is the
// ONLY authority over game rules, results, colors and Elo. Clients send
// commands; nothing a client says is trusted until this script validates it,
// and only messages this script returns in `broadcast` are relayed to the
// other client.
//
// Host contract (see starhermit src/Platform.Application/Services/GameScript*):
// the host loads this file into a fresh, constrained JS engine per invocation
// (memory limit + statement/time limit are the platform's per-game budgets)
// and calls one of the functions on `globalThis.game`:
//
//   game.createSession(ctx)          -> called once when a session is created
//   game.onPlayerMessage(ctx)        -> a client sent a command (ctx.message)
//   game.onTick(ctx)                 -> periodic timer (move-timeout sweeps)
//
// ctx = {
//   now:          ms since epoch (host clock — scripts get no Date access)
//   random:       float in [0,1) supplied by the host per invocation
//   sessionId:    string
//   players:      [{ id, name }]                 // session participants
//   sessionState: object|null                    // this script's session doc
//   playerStates: { [playerId]: object|null }    // this script's per-player
//                                                // docs (Elo, history, pairing
//                                                // colors) — each capped by the
//                                                // per-player state budget
//   message:      { from, data } | undefined     // onPlayerMessage only
// }
//
// Every entry point returns:
// {
//   ok:            bool,
//   error:         string           (when !ok; sent only to the sender)
//   sessionState:  object           (replaces stored session state)
//   playerStates:  { id: object }   (replaces stored docs for these players)
//   broadcast:     [{ to: [ids]|'all', data }]   // validated relay messages
//   eloUpdates:    { id: number }   (host publishes to the game leaderboard)
//   result:        { kind:'white'|'black'|'draw', reason } (ends the session;
//                  host archives sessionState as the replay)
// }
// =============================================================================
'use strict';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
var MOVE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h per move, else you lose
var ELO_K = 32;
var ELO_START = 1200;
var HISTORY_KEEP = 30;          // recent finished games kept per player (replays)
var PAIRINGS_KEEP = 200;        // remembered last-color-vs entries per player

// ---------------------------------------------------------------------------
// Chess engine — board is a 64-slot array, index = rank*8+file, rank 0 = White's
// back rank ("a1"=0). Pieces are single chars: PNBRQK white, pnbrqk black.
// ---------------------------------------------------------------------------

var START_BOARD =
  'RNBQKBNR' + 'PPPPPPPP' + '........' + '........' +
  '........' + '........' + 'pppppppp' + 'rnbqkbnr';

function isWhitePiece(p) { return p >= 'A' && p <= 'Z'; }
function pieceColor(p) { return p === '.' ? null : (isWhitePiece(p) ? 'white' : 'black'); }
function sq(file, rank) { return rank * 8 + file; }
function fileOf(i) { return i % 8; }
function rankOf(i) { return (i - i % 8) / 8; }
function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

function algebraic(i) {
  return 'abcdefgh'[fileOf(i)] + (rankOf(i) + 1);
}
function parseSquare(s) {
  if (typeof s !== 'string' || s.length !== 2) return -1;
  var f = 'abcdefgh'.indexOf(s[0]);
  var r = '12345678'.indexOf(s[1]);
  return (f < 0 || r < 0) ? -1 : sq(f, r);
}

function newGameState() {
  return {
    board: START_BOARD,
    turn: 'white',
    // castling rights: K/Q = white king/queen side, k/q = black
    castling: { K: true, Q: true, k: true, q: true },
    epSquare: -1,          // en-passant target square, or -1
    halfmoveClock: 0,      // for the 50-move rule
    fullmove: 1,
    moves: [],             // [{from,to,promo,san,at}] — the replay record
    positionCounts: {},    // repetition detection: key -> count
    status: 'active',      // active | finished
  };
}

function boardSet(board, i, p) {
  return board.substring(0, i) + p + board.substring(i + 1);
}

// --- attack detection --------------------------------------------------------

var KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
var KING_DELTAS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
var ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
var BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Is square i attacked by `byColor`?
function isAttacked(board, i, byColor) {
  var f = fileOf(i), r = rankOf(i), d, k, p;
  // pawns (they attack diagonally toward the enemy)
  var pr = byColor === 'white' ? r - 1 : r + 1;
  var pawn = byColor === 'white' ? 'P' : 'p';
  if (onBoard(f - 1, pr) && board[sq(f - 1, pr)] === pawn) return true;
  if (onBoard(f + 1, pr) && board[sq(f + 1, pr)] === pawn) return true;
  // knights
  var knight = byColor === 'white' ? 'N' : 'n';
  for (k = 0; k < 8; k++) {
    d = KNIGHT_DELTAS[k];
    if (onBoard(f + d[0], r + d[1]) && board[sq(f + d[0], r + d[1])] === knight) return true;
  }
  // king
  var king = byColor === 'white' ? 'K' : 'k';
  for (k = 0; k < 8; k++) {
    d = KING_DELTAS[k];
    if (onBoard(f + d[0], r + d[1]) && board[sq(f + d[0], r + d[1])] === king) return true;
  }
  // sliders
  var rook = byColor === 'white' ? 'R' : 'r';
  var bishop = byColor === 'white' ? 'B' : 'b';
  var queen = byColor === 'white' ? 'Q' : 'q';
  for (k = 0; k < 4; k++) {
    d = ROOK_DIRS[k];
    var ff = f + d[0], rr = r + d[1];
    while (onBoard(ff, rr)) {
      p = board[sq(ff, rr)];
      if (p !== '.') { if (p === rook || p === queen) return true; break; }
      ff += d[0]; rr += d[1];
    }
  }
  for (k = 0; k < 4; k++) {
    d = BISHOP_DIRS[k];
    var f2 = f + d[0], r2 = r + d[1];
    while (onBoard(f2, r2)) {
      p = board[sq(f2, r2)];
      if (p !== '.') { if (p === bishop || p === queen) return true; break; }
      f2 += d[0]; r2 += d[1];
    }
  }
  return false;
}

function findKing(board, color) {
  var king = color === 'white' ? 'K' : 'k';
  for (var i = 0; i < 64; i++) if (board[i] === king) return i;
  return -1;
}

function inCheck(board, color) {
  var ki = findKing(board, color);
  return ki >= 0 && isAttacked(board, ki, color === 'white' ? 'black' : 'white');
}

// --- pseudo-legal move generation -------------------------------------------

// Returns [{from,to,promo?,isEp?,isCastle?,is2?}] without self-check filtering.
function pseudoMovesFrom(g, from) {
  var board = g.board, piece = board[from];
  if (piece === '.') return [];
  var color = pieceColor(piece);
  var f = fileOf(from), r = rankOf(from);
  var out = [], k, d;

  function push(to, extra) {
    var m = { from: from, to: to };
    if (extra) for (var key in extra) m[key] = extra[key];
    // pawn promotion expansion happens in legalMovesFrom
    out.push(m);
  }
  function tryStep(ff, rr) {
    if (!onBoard(ff, rr)) return;
    var t = sq(ff, rr), tp = board[t];
    if (tp === '.' || pieceColor(tp) !== color) push(t);
  }
  function slide(dirs) {
    for (var k2 = 0; k2 < dirs.length; k2++) {
      var d2 = dirs[k2], ff = f + d2[0], rr = r + d2[1];
      while (onBoard(ff, rr)) {
        var t = sq(ff, rr), tp = board[t];
        if (tp === '.') push(t);
        else { if (pieceColor(tp) !== color) push(t); break; }
        ff += d2[0]; rr += d2[1];
      }
    }
  }

  var up = piece.toLowerCase();
  if (up === 'p') {
    var dir = color === 'white' ? 1 : -1;
    var startRank = color === 'white' ? 1 : 6;
    // forward
    if (onBoard(f, r + dir) && board[sq(f, r + dir)] === '.') {
      push(sq(f, r + dir));
      if (r === startRank && board[sq(f, r + 2 * dir)] === '.') push(sq(f, r + 2 * dir), { is2: true });
    }
    // captures
    for (k = -1; k <= 1; k += 2) {
      if (!onBoard(f + k, r + dir)) continue;
      var t = sq(f + k, r + dir), tp = board[t];
      if (tp !== '.' && pieceColor(tp) !== color) push(t);
      else if (t === g.epSquare && tp === '.') push(t, { isEp: true });
    }
  } else if (up === 'n') {
    for (k = 0; k < 8; k++) { d = KNIGHT_DELTAS[k]; tryStep(f + d[0], r + d[1]); }
  } else if (up === 'b') slide(BISHOP_DIRS);
  else if (up === 'r') slide(ROOK_DIRS);
  else if (up === 'q') slide(ROOK_DIRS.concat(BISHOP_DIRS));
  else if (up === 'k') {
    for (k = 0; k < 8; k++) { d = KING_DELTAS[k]; tryStep(f + d[0], r + d[1]); }
    // castling: king and rook unmoved, path empty, king not through check
    var enemy = color === 'white' ? 'black' : 'white';
    var home = color === 'white' ? 0 : 7;
    if (r === home && f === 4 && !isAttacked(board, from, enemy)) {
      var ksRight = color === 'white' ? g.castling.K : g.castling.k;
      var qsRight = color === 'white' ? g.castling.Q : g.castling.q;
      if (ksRight && board[sq(5, home)] === '.' && board[sq(6, home)] === '.' &&
          !isAttacked(board, sq(5, home), enemy) && !isAttacked(board, sq(6, home), enemy))
        push(sq(6, home), { isCastle: 'K' });
      if (qsRight && board[sq(3, home)] === '.' && board[sq(2, home)] === '.' && board[sq(1, home)] === '.' &&
          !isAttacked(board, sq(3, home), enemy) && !isAttacked(board, sq(2, home), enemy))
        push(sq(2, home), { isCastle: 'Q' });
    }
  }
  return out;
}

// Apply a pseudo-legal move to a copy of the position; returns new {board, epSquare, castling}.
function applyMoveToBoard(g, m) {
  var board = g.board;
  var piece = board[m.from];
  var color = pieceColor(piece);
  var epSquare = -1;
  var castling = { K: g.castling.K, Q: g.castling.Q, k: g.castling.k, q: g.castling.q };

  board = boardSet(board, m.from, '.');
  // en passant removes the pawn behind the target square
  if (m.isEp) {
    var capRank = color === 'white' ? rankOf(m.to) - 1 : rankOf(m.to) + 1;
    board = boardSet(board, sq(fileOf(m.to), capRank), '.');
  }
  var landing = m.promo
    ? (color === 'white' ? m.promo.toUpperCase() : m.promo.toLowerCase())
    : piece;
  board = boardSet(board, m.to, landing);

  if (m.isCastle) {
    var home = color === 'white' ? 0 : 7;
    if (m.isCastle === 'K') {
      board = boardSet(board, sq(7, home), '.');
      board = boardSet(board, sq(5, home), color === 'white' ? 'R' : 'r');
    } else {
      board = boardSet(board, sq(0, home), '.');
      board = boardSet(board, sq(3, home), color === 'white' ? 'R' : 'r');
    }
  }
  if (m.is2) epSquare = color === 'white' ? m.from + 8 : m.from - 8;

  // castling-right bookkeeping
  var pl = piece.toLowerCase();
  if (pl === 'k') { if (color === 'white') { castling.K = castling.Q = false; } else { castling.k = castling.q = false; } }
  if (m.from === sq(0, 0) || m.to === sq(0, 0)) castling.Q = false;
  if (m.from === sq(7, 0) || m.to === sq(7, 0)) castling.K = false;
  if (m.from === sq(0, 7) || m.to === sq(0, 7)) castling.q = false;
  if (m.from === sq(7, 7) || m.to === sq(7, 7)) castling.k = false;

  return { board: board, epSquare: epSquare, castling: castling };
}

// Fully legal moves from a square (self-check filtered, promotions expanded).
function legalMovesFrom(g, from) {
  var piece = g.board[from];
  if (piece === '.' || pieceColor(piece) !== g.turn) return [];
  var pseudo = pseudoMovesFrom(g, from);
  var legal = [];
  for (var i = 0; i < pseudo.length; i++) {
    var m = pseudo[i];
    var next = applyMoveToBoard(g, m);
    if (inCheck(next.board, g.turn)) continue;
    // promotion expansion
    var isPromo = piece.toLowerCase() === 'p' &&
      (rankOf(m.to) === 7 || rankOf(m.to) === 0);
    if (isPromo) {
      var promos = ['q', 'r', 'b', 'n'];
      for (var k = 0; k < 4; k++) {
        var pm = { from: m.from, to: m.to, promo: promos[k] };
        if (m.isEp) pm.isEp = true;
        legal.push(pm);
      }
    } else legal.push(m);
  }
  return legal;
}

function allLegalMoves(g) {
  var out = [];
  for (var i = 0; i < 64; i++) {
    if (g.board[i] !== '.' && pieceColor(g.board[i]) === g.turn)
      out = out.concat(legalMovesFrom(g, i));
  }
  return out;
}

// Position key for threefold repetition (board + turn + castling + ep).
function positionKey(g) {
  return g.board + '|' + g.turn + '|' +
    (g.castling.K ? 'K' : '') + (g.castling.Q ? 'Q' : '') +
    (g.castling.k ? 'k' : '') + (g.castling.q ? 'q' : '') + '|' + g.epSquare;
}

function insufficientMaterial(board) {
  // K vs K, K+B vs K, K+N vs K, K+B vs K+B with same-color bishops
  var minor = [], bishopsSquares = [];
  for (var i = 0; i < 64; i++) {
    var p = board[i];
    if (p === '.' || p.toLowerCase() === 'k') continue;
    var pl = p.toLowerCase();
    if (pl === 'q' || pl === 'r' || pl === 'p') return false;
    minor.push(pl);
    if (pl === 'b') bishopsSquares.push((fileOf(i) + rankOf(i)) % 2);
  }
  if (minor.length <= 1) return true;
  if (minor.length === 2 && bishopsSquares.length === 2 && bishopsSquares[0] === bishopsSquares[1]) return true;
  return false;
}

// SAN-ish notation for the replay record (disambiguation kept simple).
function sanFor(g, m, gaveCheck, wasMate) {
  var piece = g.board[m.from];
  var pl = piece.toLowerCase();
  var capture = g.board[m.to] !== '.' || m.isEp;
  var s;
  if (m.isCastle === 'K') s = 'O-O';
  else if (m.isCastle === 'Q') s = 'O-O-O';
  else {
    s = pl === 'p'
      ? (capture ? 'abcdefgh'[fileOf(m.from)] + 'x' : '')
      : piece.toUpperCase().replace('P', '') + (capture ? 'x' : '');
    if (pl !== 'p') {
      // minimal disambiguation: add file if another same-type piece also reaches `to`
      for (var i = 0; i < 64; i++) {
        if (i !== m.from && g.board[i] === piece) {
          var others = legalMovesFrom(g, i);
          for (var k = 0; k < others.length; k++) {
            if (others[k].to === m.to) {
              s = s.substring(0, 1) + 'abcdefgh'[fileOf(m.from)] + s.substring(1);
              i = 64; break;
            }
          }
        }
      }
    }
    s += algebraic(m.to);
    if (m.promo) s += '=' + m.promo.toUpperCase();
  }
  if (wasMate) s += '#';
  else if (gaveCheck) s += '+';
  return s;
}

// Validate and apply a move request {from:'e2', to:'e4', promo?:'q'}.
// Returns {ok, error?, san?, gameOver?:{kind,reason}}. Mutates g.
function makeMove(g, req, now) {
  var from = parseSquare(req.from), to = parseSquare(req.to);
  if (from < 0 || to < 0) return { ok: false, error: 'Malformed square.' };
  var promo = null;
  if (req.promo != null) {
    if (['q', 'r', 'b', 'n'].indexOf(String(req.promo).toLowerCase()) < 0)
      return { ok: false, error: 'Invalid promotion piece.' };
    promo = String(req.promo).toLowerCase();
  }
  var candidates = legalMovesFrom(g, from);
  var m = null;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (c.to === to && (c.promo || null) === promo) { m = c; break; }
  }
  if (!m) {
    // promotion move sent without promo piece
    for (i = 0; i < candidates.length; i++) {
      if (candidates[i].to === to && candidates[i].promo)
        return { ok: false, error: 'Promotion piece required (q, r, b or n).' };
    }
    return { ok: false, error: 'Illegal move.' };
  }

  var movedPiece = g.board[m.from];
  var wasCapture = g.board[m.to] !== '.' || !!m.isEp;
  var next = applyMoveToBoard(g, m);
  var mover = g.turn;
  var opponent = mover === 'white' ? 'black' : 'white';

  // SAN must be computed against the pre-move position, but check/mate against
  // the post-move one — compute post-move facts first on a probe state.
  var probe = {
    board: next.board, turn: opponent, castling: next.castling,
    epSquare: next.epSquare, halfmoveClock: 0, fullmove: 1,
  };
  var gaveCheck = inCheck(next.board, opponent);
  var replyMoves = allLegalMoves(probe);
  var wasMate = gaveCheck && replyMoves.length === 0;
  var san = sanFor(g, m, gaveCheck, wasMate);

  g.board = next.board;
  g.castling = next.castling;
  g.epSquare = next.epSquare;
  g.turn = opponent;
  if (movedPiece.toLowerCase() === 'p' || wasCapture) g.halfmoveClock = 0;
  else g.halfmoveClock++;
  if (mover === 'black') g.fullmove++;
  g.moves.push({ from: req.from, to: req.to, promo: promo || undefined, san: san, at: now });

  var key = positionKey(g);
  g.positionCounts[key] = (g.positionCounts[key] || 0) + 1;

  if (wasMate) return { ok: true, san: san, gameOver: { kind: mover, reason: 'checkmate' } };
  if (replyMoves.length === 0) return { ok: true, san: san, gameOver: { kind: 'draw', reason: 'stalemate' } };
  if (g.positionCounts[key] >= 3) return { ok: true, san: san, gameOver: { kind: 'draw', reason: 'threefold-repetition' } };
  if (g.halfmoveClock >= 100) return { ok: true, san: san, gameOver: { kind: 'draw', reason: 'fifty-move-rule' } };
  if (insufficientMaterial(g.board)) return { ok: true, san: san, gameOver: { kind: 'draw', reason: 'insufficient-material' } };
  return { ok: true, san: san };
}

// ---------------------------------------------------------------------------
// Elo
// ---------------------------------------------------------------------------

function expectedScore(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }

// result: 1 = a wins, 0 = b wins, 0.5 = draw. Returns [newA, newB].
function eloAfter(a, b, result) {
  var ea = expectedScore(a, b);
  return [
    Math.round(a + ELO_K * (result - ea)),
    Math.round(b + ELO_K * ((1 - result) - (1 - ea))),
  ];
}

// ---------------------------------------------------------------------------
// Per-player persistent doc (lives under the platform's per-player state
// budget — default 5 MB, platform-enforced). Everything here is script-owned.
// ---------------------------------------------------------------------------

function defaultPlayerDoc() {
  return {
    elo: ELO_START,
    wins: 0, losses: 0, draws: 0,
    // last color played against each opponent, for strict alternation
    lastColorVs: {},        // opponentId -> 'white' | 'black'
    lastColorOrder: [],     // LRU of opponentIds so the map stays bounded
    recentGames: [],        // finished games, newest first (replay index)
  };
}

function playerDoc(ctx, id) {
  return ctx.playerStates[id] || defaultPlayerDoc();
}

function rememberColor(doc, oppId, color) {
  if (!(oppId in doc.lastColorVs)) {
    doc.lastColorOrder.push(oppId);
    if (doc.lastColorOrder.length > PAIRINGS_KEEP) {
      var evict = doc.lastColorOrder.shift();
      delete doc.lastColorVs[evict];
    }
  }
  doc.lastColorVs[oppId] = color;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function otherId(s, id) { return s.white === id ? s.black : s.white; }
function colorOf(s, id) { return s.white === id ? 'white' : (s.black === id ? 'black' : null); }

// Top-level `summary` is the one platform-readable window into session state
// (used for the "my games" list: whose move, deadline, move count).
function syncSummary(s) {
  s.summary = {
    turnPlayerId: s.game.status === 'active' ? (s.game.turn === 'white' ? s.white : s.black) : null,
    deadline: s.game.status === 'active' ? s.deadline : null,
    status: s.game.status,
    moveCount: s.game.moves.length,
  };
}

function publicSessionView(s) {
  return {
    type: 'state',
    white: s.white, black: s.black,
    board: s.game.board, turn: s.game.turn,
    // moves is snapshotted: an AI reply can mutate the game inside the same
    // invocation after this view was built for the human's own move message
    moves: s.game.moves.slice(),
    status: s.game.status,
    result: s.result || null,
    deadline: s.deadline,
    drawOfferBy: s.drawOfferBy || null,
    ai: s.aiId ? colorOf(s, s.aiId) : null,   // which color the AI plays, if any
  };
}

// Ends the session: updates both player docs, produces eloUpdates + result.
// Practice (AI) games are unrated: status/result only, no doc or elo changes.
function finishGame(ctx, s, kind, reason) {
  if (s.aiId) {
    s.game.status = 'finished';
    s.result = { kind: kind, reason: reason, at: ctx.now };
    syncSummary(s);
    return {
      result: {
        kind: kind, reason: reason, at: ctx.now,
        white: s.white, black: s.black,
        moveCount: s.game.moves.length,
        practice: true,
      },
    };
  }

  var whiteDoc = playerDoc(ctx, s.white);
  var blackDoc = playerDoc(ctx, s.black);

  var score = kind === 'white' ? 1 : (kind === 'black' ? 0 : 0.5);
  var next = eloAfter(whiteDoc.elo, blackDoc.elo, score);
  var eloBefore = { white: whiteDoc.elo, black: blackDoc.elo };
  whiteDoc.elo = next[0];
  blackDoc.elo = next[1];
  if (kind === 'white') { whiteDoc.wins++; blackDoc.losses++; }
  else if (kind === 'black') { blackDoc.wins++; whiteDoc.losses++; }
  else { whiteDoc.draws++; blackDoc.draws++; }

  s.game.status = 'finished';
  s.result = { kind: kind, reason: reason, at: ctx.now };

  var summary = {
    sessionId: ctx.sessionId,
    white: s.white, black: s.black,
    result: kind, reason: reason, at: ctx.now,
    moveCount: s.game.moves.length,
    eloBefore: eloBefore,
    eloAfter: { white: whiteDoc.elo, black: blackDoc.elo },
  };
  whiteDoc.recentGames.unshift(summary);
  blackDoc.recentGames.unshift(summary);
  if (whiteDoc.recentGames.length > HISTORY_KEEP) whiteDoc.recentGames.length = HISTORY_KEEP;
  if (blackDoc.recentGames.length > HISTORY_KEEP) blackDoc.recentGames.length = HISTORY_KEEP;

  var updates = {};
  updates[s.white] = whiteDoc;
  updates[s.black] = blackDoc;
  var elo = {};
  elo[s.white] = whiteDoc.elo;
  elo[s.black] = blackDoc.elo;

  var eloBeforeById = {};
  eloBeforeById[s.white] = eloBefore.white;
  eloBeforeById[s.black] = eloBefore.black;

  syncSummary(s);

  return {
    playerStates: updates,
    eloUpdates: elo,
    // Persisted as the session's result record and surfaced in replay listings —
    // rich enough for a client to show "who won, why, and the rating change".
    result: {
      kind: kind, reason: reason, at: ctx.now,
      white: s.white, black: s.black,
      moveCount: s.game.moves.length,
      eloBefore: eloBeforeById,
      eloAfter: elo,
    },
  };
}

// ---------------------------------------------------------------------------
// Greedy AI (practice sessions). The platform flags the AI seat with ai:true
// in createSession; this script then plays that seat itself. Pure material
// greed: take the most valuable capture/promotion available, otherwise any
// move, with tie-breaks derived from the host-supplied random.
// ---------------------------------------------------------------------------
var PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function greedyPick(g, seed) {
  var moves = allLegalMoves(g);
  if (!moves.length) return null;
  // tiny LCG so the single host random float yields a whole tie-break sequence
  var state = (Math.floor(seed * 2147483645) % 2147483646) + 1;
  function rnd() { state = (state * 48271) % 2147483647; return state / 2147483647; }
  var best = null, bestScore = -1, ties = 0;
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i], score = 0;
    var target = g.board[m.to];
    if (target !== '.') score += PIECE_VALUE[target.toLowerCase()] || 0;
    if (m.isEp) score += 1;
    if (m.promo) score += (PIECE_VALUE[m.promo] || 0) - 1;
    if (score > bestScore) { bestScore = score; best = m; ties = 1; }
    else if (score === bestScore) { ties++; if (rnd() < 1 / ties) best = m; }
  }
  return best;
}

// While the AI seat is to move in an active practice game, play one greedy
// move: mutates s and appends to `out` exactly like a player's move would.
function aiReply(ctx, s, out) {
  if (!s.aiId || s.game.status !== 'active') return;
  var aiColor = colorOf(s, s.aiId);
  if (s.game.turn !== aiColor) return;
  var m = greedyPick(s.game, ctx.random);
  if (!m) return;
  var req = { from: algebraic(m.from), to: algebraic(m.to), promo: m.promo || null };
  var res = makeMove(s.game, req, ctx.now);
  if (!res.ok) return; // unreachable for a legal move; worst case the human wins on time
  s.drawOfferBy = null;
  s.deadline = ctx.now + MOVE_TIMEOUT_MS;
  syncSummary(s);
  out.broadcast.push({
    to: 'all',
    data: { type: 'moved', by: aiColor, san: res.san, from: req.from, to: req.to, promo: req.promo, view: publicSessionView(s) },
  });
  if (res.gameOver) {
    var fin = finishGame(ctx, s, res.gameOver.kind, res.gameOver.reason);
    out.result = fin.result;
    out.broadcast.push({ to: 'all', data: { type: 'game-over', result: s.result, view: publicSessionView(s) } });
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

globalThis.game = {

  // A new session between exactly two players. Colors: random the first time a
  // pair meets, then alternate on every subsequent game between the same two.
  createSession: function (ctx) {
    if (!ctx.players || ctx.players.length !== 2)
      return { ok: false, error: 'Chess needs exactly 2 players.' };
    var a = ctx.players[0].id, b = ctx.players[1].id;
    if (a === b) return { ok: false, error: 'Cannot play yourself.' };

    // Practice session: one seat is the platform's AI. Unrated, colors random
    // every time (no pairing memory), and the AI opens immediately when white.
    var aiEntry = ctx.players[0].ai ? ctx.players[0] : (ctx.players[1].ai ? ctx.players[1] : null);
    if (aiEntry) {
      if (ctx.players[0].ai && ctx.players[1].ai)
        return { ok: false, error: 'Practice needs a human.' };
      var humanId = aiEntry.id === a ? b : a;
      var humanIsWhite = ctx.random < 0.5;
      var ps = {
        white: humanIsWhite ? humanId : aiEntry.id,
        black: humanIsWhite ? aiEntry.id : humanId,
        aiId: aiEntry.id,
        game: newGameState(),
        createdAt: ctx.now,
        deadline: ctx.now + MOVE_TIMEOUT_MS,
        result: null,
        drawOfferBy: null,
      };
      syncSummary(ps);
      var pout = { ok: true, sessionState: ps, broadcast: [] };
      aiReply(ctx, ps, pout);
      pout.broadcast.push({ to: 'all', data: publicSessionView(ps) });
      return pout;
    }

    var aDoc = playerDoc(ctx, a);
    var bDoc = playerDoc(ctx, b);

    var aIsWhite;
    var prev = aDoc.lastColorVs[b];
    if (prev === 'white') aIsWhite = false;        // alternate
    else if (prev === 'black') aIsWhite = true;
    else aIsWhite = ctx.random < 0.5;              // first meeting: random

    var white = aIsWhite ? a : b;
    var black = aIsWhite ? b : a;
    rememberColor(aDoc, b, aIsWhite ? 'white' : 'black');
    rememberColor(bDoc, a, aIsWhite ? 'black' : 'white');

    var s = {
      white: white, black: black,
      game: newGameState(),
      createdAt: ctx.now,
      deadline: ctx.now + MOVE_TIMEOUT_MS,   // white's clock starts immediately
      result: null,
      drawOfferBy: null,
    };
    syncSummary(s);

    var playerStates = {};
    playerStates[a] = aDoc;
    playerStates[b] = bDoc;

    return {
      ok: true,
      sessionState: s,
      playerStates: playerStates,
      broadcast: [{ to: 'all', data: publicSessionView(s) }],
    };
  },

  // Every client command flows through here. Nothing is relayed unless this
  // function explicitly returns it in `broadcast`.
  onPlayerMessage: function (ctx) {
    var s = ctx.sessionState;
    if (!s) return { ok: false, error: 'No such session.' };
    var from = ctx.message.from;
    var data = ctx.message.data || {};
    var color = colorOf(s, from);
    if (!color) return { ok: false, error: 'You are not a player in this game.' };

    // --- commands that work on finished games -----------------------------
    if (data.type === 'sync') {
      return { ok: true, broadcast: [{ to: [from], data: publicSessionView(s) }] };
    }
    if (s.game.status !== 'active')
      return { ok: false, error: 'Game is over.' };

    // --- game commands ----------------------------------------------------
    if (data.type === 'move') {
      if (s.game.turn !== color) return { ok: false, error: 'Not your turn.' };
      var res = makeMove(s.game, { from: data.from, to: data.to, promo: data.promo }, ctx.now);
      if (!res.ok) return { ok: false, error: res.error };
      s.drawOfferBy = null;                          // a move declines any offer
      s.deadline = ctx.now + MOVE_TIMEOUT_MS;        // opponent's 24h starts now
      syncSummary(s);
      var out = {
        ok: true,
        sessionState: s,
        broadcast: [{
          to: 'all',
          data: { type: 'moved', by: color, san: res.san, from: data.from, to: data.to, promo: data.promo || null, view: publicSessionView(s) },
        }],
      };
      if (res.gameOver) {
        var fin = finishGame(ctx, s, res.gameOver.kind, res.gameOver.reason);
        out.playerStates = fin.playerStates;
        out.eloUpdates = fin.eloUpdates;
        out.result = fin.result;
        out.broadcast.push({ to: 'all', data: { type: 'game-over', result: s.result, view: publicSessionView(s) } });
      } else {
        aiReply(ctx, s, out);   // no-op unless a practice game with the AI to move
      }
      return out;
    }

    if (data.type === 'resign') {
      var winner = color === 'white' ? 'black' : 'white';
      var fin2 = finishGame(ctx, s, winner, 'resignation');
      return {
        ok: true, sessionState: s,
        playerStates: fin2.playerStates, eloUpdates: fin2.eloUpdates, result: fin2.result,
        broadcast: [{ to: 'all', data: { type: 'game-over', result: s.result, view: publicSessionView(s) } }],
      };
    }

    if (data.type === 'offer-draw') {
      if (s.aiId) {
        // the house declines instantly; no pending-offer state
        return { ok: true, broadcast: [{ to: 'all', data: { type: 'draw-declined', by: colorOf(s, s.aiId) } }] };
      }
      if (s.drawOfferBy === color) return { ok: false, error: 'Draw already offered.' };
      if (s.drawOfferBy) {
        // both sides have now offered — that's an agreement
        var fin3 = finishGame(ctx, s, 'draw', 'agreement');
        return {
          ok: true, sessionState: s,
          playerStates: fin3.playerStates, eloUpdates: fin3.eloUpdates, result: fin3.result,
          broadcast: [{ to: 'all', data: { type: 'game-over', result: s.result, view: publicSessionView(s) } }],
        };
      }
      s.drawOfferBy = color;
      return {
        ok: true, sessionState: s,
        broadcast: [{ to: 'all', data: { type: 'draw-offered', by: color } }],
      };
    }

    if (data.type === 'accept-draw') {
      if (!s.drawOfferBy || s.drawOfferBy === color)
        return { ok: false, error: 'No draw offer to accept.' };
      var fin4 = finishGame(ctx, s, 'draw', 'agreement');
      return {
        ok: true, sessionState: s,
        playerStates: fin4.playerStates, eloUpdates: fin4.eloUpdates, result: fin4.result,
        broadcast: [{ to: 'all', data: { type: 'game-over', result: s.result, view: publicSessionView(s) } }],
      };
    }

    if (data.type === 'decline-draw') {
      if (!s.drawOfferBy || s.drawOfferBy === color)
        return { ok: false, error: 'No draw offer to decline.' };
      s.drawOfferBy = null;
      return {
        ok: true, sessionState: s,
        broadcast: [{ to: 'all', data: { type: 'draw-declined', by: color } }],
      };
    }

    return { ok: false, error: 'Unknown command: ' + String(data.type) };
  },

  // Periodic sweep from the platform. Adjudicates the 24h move timeout:
  //  - nobody has moved yet  -> draw (no rating change beyond the draw math? no:
  //    spec says it "counts as a draw", so it is rated as one)
  //  - somebody has moved    -> the player to move loses on time
  onTick: function (ctx) {
    var s = ctx.sessionState;
    if (!s || s.game.status !== 'active') return { ok: true };
    if (ctx.now < s.deadline) return { ok: true };

    var fin;
    if (s.game.moves.length === 0) {
      fin = finishGame(ctx, s, 'draw', 'timeout-no-moves');
    } else {
      var winner = s.game.turn === 'white' ? 'black' : 'white';
      fin = finishGame(ctx, s, winner, 'timeout');
    }
    return {
      ok: true, sessionState: s,
      playerStates: fin.playerStates, eloUpdates: fin.eloUpdates, result: fin.result,
      broadcast: [{ to: 'all', data: { type: 'game-over', result: s.result, view: publicSessionView(s) } }],
    };
  },
};

// ---------------------------------------------------------------------------
// Client-side reuse. The browser client loads this same file to get legal-move
// highlighting and replay stepping without duplicating the rules. The platform
// host only ever calls `globalThis.game`; nothing here grants the client any
// authority — every command is still validated server-side.
// ---------------------------------------------------------------------------
globalThis.chessRules = {
  START_BOARD: START_BOARD,
  newGameState: newGameState,
  legalMovesFrom: legalMovesFrom,
  allLegalMoves: allLegalMoves,
  makeMove: makeMove,
  inCheck: inCheck,
  pieceColor: pieceColor,
  parseSquare: parseSquare,
  algebraic: algebraic,
  fileOf: fileOf,
  rankOf: rankOf,
};
