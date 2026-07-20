// dev/mock-server.mjs — smoke-test harness, NOT a deliverable.
// Serves the static frontend and stubs just enough of the starhermit REST/WS
// surface (canned data, two fake players) to drive the UI by hand:
//
//   node dev/mock-server.mjs        →  http://localhost:5050/
//
// Paste ANY text as the "user JWT" in the dev panel; the mock accepts it and
// signs you in as Alice. Bob answers your moves with a random legal move.
// It hosts the real server.js game script, so play is fully rule-checked.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5050;

// ---- load the real game script (defines globalThis.game / chessRules) ------
(0, eval)(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
const script = globalThis.game;
const rules = globalThis.chessRules;

// ---- fake world -------------------------------------------------------------
const ALICE = { id: 'u-alice', name: 'Alice' };
const BOB = { id: 'u-bob', name: 'Bob' };
const players = [{ id: ALICE.id, name: ALICE.name }, { id: BOB.id, name: BOB.name }];
const playerStates = {}; // per-player docs owned by the script

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = () => b64u({ alg: 'none' }) + '.' +
  b64u({ sub: ALICE.id, game_scope: 'chess', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';

function ctx(sessionId, sessionState, message) {
  return {
    now: Date.now(), random: Math.random(), sessionId, players,
    sessionState, playerStates: { ...playerStates }, message,
  };
}
function absorb(session, out) {
  if (out.sessionState) session.state = out.sessionState;
  if (out.playerStates) Object.assign(playerStates, out.playerStates);
  if (out.result) session.finished = { ...out.result, at: Date.now() };
  return out;
}

// live session s1 (Alice vs Bob) created by the real script
const s1 = { id: 's1', convId: 'c-1', state: null, finished: null, createdAt: Date.now() };
absorb(s1, script.createSession(ctx(s1.id, null)));
// deterministic smoke tool: Alice always plays white in the live session
if (s1.state.white !== ALICE.id) { s1.state.white = ALICE.id; s1.state.black = BOB.id; }

// a canned finished game for the replay list (fool's mate, Bob mates Alice)
const foolsG = rules.newGameState();
for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
  rules.makeMove(foolsG, { from: f, to: t }, Date.now() - 86400000);
}
const replayS0 = {
  sessionId: 's0', white: ALICE.id, black: BOB.id,
  players: [{ userId: ALICE.id, username: ALICE.name }, { userId: BOB.id, username: BOB.name }],
  moves: foolsG.moves,
  result: { kind: 'black', reason: 'checkmate', at: Date.now() - 86000000 },
};

const chatLog = [
  { id: 'm1', conversationId: 'c-1', senderId: BOB.id, content: 'Good luck — take your time.', sentAt: Date.now() - 3600000 },
];
let msgSeq = 2;
let mmTicket = null;

// ---- tiny websocket layer ---------------------------------------------------
const wsClients = new Set(); // { socket, path, query, userId, send(obj) }

function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
}
function wsSendText(socket, str) {
  const data = Buffer.from(str);
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  try { socket.write(Buffer.concat([header, data])); } catch { /* gone */ }
}
function wsParse(buf, onText, socket) {
  let off = 0;
  while (off + 2 <= buf.length) {
    const op = buf[off] & 0x0f;
    let len = buf[off + 1] & 0x7f;
    const masked = !!(buf[off + 1] & 0x80);
    let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask = null;
    if (masked) { if (p + 4 > buf.length) break; mask = buf.subarray(p, p + 4); p += 4; }
    if (p + len > buf.length) break;
    let payload = buf.subarray(p, p + len);
    if (mask) payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    if (op === 1) onText(payload.toString());
    else if (op === 8) { socket.end(); return buf.subarray(buf.length); }
    else if (op === 9) { const pong = Buffer.from([0x8a, payload.length]); socket.write(Buffer.concat([pong, payload])); }
    off = p + len;
  }
  return buf.subarray(off);
}

function relay(broadcasts, sessionId, senderId) {
  for (const b of broadcasts || []) {
    const targets = b.to === 'all' ? [ALICE.id, BOB.id] : b.to;
    for (const c of wsClients) {
      if (c.path === '/ws/v1/games' && c.query.get('sessionId') === sessionId && targets.includes(c.userId)) {
        c.send({ type: 'game', data: b.data });
      }
    }
  }
  void senderId;
}

function handleGameCmd(session, from, data, client) {
  const out = script.onPlayerMessage(ctx(session.id, session.state, { from, data }));
  if (!out.ok) { if (client) client.send({ type: 'error', error: out.error }); return; }
  absorb(session, out);
  relay(out.broadcast, session.id, from);
  // Bob answers a real move after a moment.
  if (data.type === 'move' && session.state.game.status === 'active' &&
      rules.pieceColor && session.state.game.turn === (session.state.white === BOB.id ? 'white' : 'black')) {
    setTimeout(() => {
      const g = session.state.game;
      if (g.status !== 'active') return;
      const moves = rules.allLegalMoves(g);
      if (!moves.length) return;
      const m = moves[Math.floor(Math.random() * moves.length)];
      handleGameCmd(session, BOB.id, {
        type: 'move', from: rules.algebraic(m.from), to: rules.algebraic(m.to), promo: m.promo,
      }, null);
    }, 1200);
  }
  if (data.type === 'offer-draw' && session.state.drawOfferBy) {
    setTimeout(() => handleGameCmd(session, BOB.id, { type: 'decline-draw' }, null), 1500);
  }
}

// ---- REST -------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

function sessionView(session) {
  const st = session.state;
  return {
    sessionId: session.id, status: session.finished ? 'finished' : 'active',
    players: [{ userId: ALICE.id, username: ALICE.name }, { userId: BOB.id, username: BOB.name }],
    createdAt: session.createdAt, finishedAt: session.finished ? session.finished.at : null,
    myTurn: session.finished ? null : st.game.turn === (st.white === ALICE.id ? 'white' : 'black'),
    deadline: session.finished ? null : st.deadline,
  };
}

const routes = {
  'POST /api/v1/games/chess/launch-token': () => ({ token: fakeJwt(), expiresInSeconds: 3600 }),
  'GET /api/v1/games/chess': () => {
    const doc = playerStates[ALICE.id] || { elo: 1184, wins: 0, losses: 1, draws: 0 };
    return {
      slug: 'chess', name: 'Chess', enabled: true, leaderboardId: 'lb-1',
      maxConcurrentSessionsPerPlayer: 20,
      me: { userId: ALICE.id, elo: doc.elo, wins: doc.wins, losses: doc.losses, draws: doc.draws, activeSessionCount: 1 },
    };
  },
  'GET /api/v1/games/chess/sessions/mine': () => [sessionView(s1)],
  'GET /api/v1/games/chess/sessions/s1': () => ({
    ...sessionView(s1), chatConversationId: s1.convId,
    result: s1.finished ? { kind: s1.finished.kind, reason: s1.finished.reason } : null,
  }),
  'POST /api/v1/games/chess/matchmaking': () => { mmTicket = { ticketId: 't1', at: Date.now() }; return { ticketId: 't1', status: 'queued' }; },
  'GET /api/v1/games/chess/matchmaking': (q, res) => {
    if (!mmTicket) { res.statusCode = 404; return { error: 'no ticket' }; }
    if (Date.now() - mmTicket.at > 4000) { mmTicket = null; return { ticketId: 't1', status: 'matched', sessionId: 's1' }; }
    return { ticketId: 't1', status: 'queued' };
  },
  'DELETE /api/v1/games/chess/matchmaking': (q, res) => { mmTicket = null; res.statusCode = 204; return null; },
  'GET /api/v1/games/chess/invites': () => ({
    incoming: [{ inviteId: 'i1', from: { userId: BOB.id, username: BOB.name }, createdAt: Date.now() - 60000 }],
    outgoing: [],
  }),
  'POST /api/v1/games/chess/invites': () => ({ inviteId: 'i2', status: 'pending' }),
  'POST /api/v1/games/chess/invites/i1/accept': () => ({ sessionId: 's1' }),
  'POST /api/v1/games/chess/invites/i1/decline': (q, res) => { res.statusCode = 204; return null; },
  'GET /api/v1/me/friends': () => [{ userId: BOB.id, username: BOB.name }],
  'GET /api/v1/games/chess/replays/mine': () => [{
    sessionId: 's0', players: replayS0.players, finishedAt: replayS0.result.at,
    result: { kind: 'black', reason: 'checkmate' }, moveCount: replayS0.moves.length,
    eloAfter: { [ALICE.id]: 1184, [BOB.id]: 1216 },
  }],
  'GET /api/v1/games/chess/replays/s0': () => replayS0,
  'GET /api/v1/leaderboards/lb-1/entries': () => ({
    entries: [
      { userId: BOB.id, username: BOB.name, score: 1216, rank: 1 },
      { userId: ALICE.id, username: ALICE.name, score: 1184, rank: 2 },
    ],
  }),
  'GET /api/v1/chat/conversations/c-1/messages': () => ({ messages: chatLog }),
  'POST /api/v1/chat/conversations/c-1/messages': (q, res, body) => {
    const msg = { id: 'm' + msgSeq++, conversationId: 'c-1', senderId: ALICE.id, content: body.content, sentAt: Date.now() };
    chatLog.push(msg);
    for (const c of wsClients) {
      if (c.path === '/ws/v1/chat') c.send({ type: 'new_message', data: { conversationId: 'c-1', message: msg } });
    }
    setTimeout(() => { // Bob replies once in a while
      const reply = { id: 'm' + msgSeq++, conversationId: 'c-1', senderId: BOB.id, content: 'Interesting…', sentAt: Date.now() };
      chatLog.push(reply);
      for (const c of wsClients) {
        if (c.path === '/ws/v1/chat') c.send({ type: 'new_message', data: { conversationId: 'c-1', message: reply } });
      }
    }, 2500);
    return msg;
  },
  'GET /api/v1/voice/rooms': () => [{ roomId: 'v-1', conversationId: 'c-1' }],
  'POST /api/v1/voice/rooms': () => ({ roomId: 'v-1', conversationId: 'c-1' }),
  'POST /api/v1/voice/rooms/v-1/join': () => ({ ok: true }),
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  const key = req.method + ' ' + u.pathname;
  if (routes[key]) {
    let raw = '';
    req.on('data', (c) => raw += c);
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      const out = routes[key](u.searchParams, res, body);
      res.setHeader('Content-Type', 'application/json');
      res.end(out === null ? '' : JSON.stringify(out));
    });
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not mocked: ' + key }));
    return;
  }
  // static
  const rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; res.end('not found'); return;
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket) => {
  const u = new URL(req.url, 'http://x');
  wsAccept(req, socket);
  const client = {
    socket, path: u.pathname, query: u.searchParams, userId: ALICE.id,
    send: (obj) => wsSendText(socket, JSON.stringify(obj)),
  };
  wsClients.add(client);
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    buf = wsParse(buf, (text) => {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      if (u.pathname === '/ws/v1/games' && msg.type === 'cmd') {
        handleGameCmd(s1, ALICE.id, msg.data || {}, client);
      } else if (u.pathname === '/ws/v1/voice') {
        // lone-participant room: echo a roster containing only the caller
        void msg;
      }
    }, socket);
  });
  socket.on('close', () => wsClients.delete(client));
  socket.on('error', () => wsClients.delete(client));
  if (u.pathname === '/ws/v1/games') {
    setTimeout(() => client.send({ type: 'presence', userId: BOB.id, online: true }), 500);
  }
  if (u.pathname === '/ws/v1/voice') {
    setTimeout(() => client.send({ type: 'voice.roster', participants: [{ userId: ALICE.id }] }), 300);
  }
});

server.listen(PORT, () => {
  console.log(`mock chess platform on http://localhost:${PORT}/ (Alice vs auto-Bob; paste anything as the JWT)`);
});
