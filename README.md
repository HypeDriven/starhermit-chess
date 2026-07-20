# Chess — multiplayer correspondence chess on starhermit

A browser chess game whose entire rules authority lives in **one server-side
JavaScript file** (`server.js`) executed by the starhermit platform in a
sandboxed, budgeted JS engine. Clients send commands; the platform runs each
one through the script, and only what the script explicitly returns is relayed
to the other player — clients can't cheat, spoof identity, or move out of turn.

## Files

- `server.js` — the single authoritative game script (chess rules incl.
  castling/en passant/promotion/mate/stalemate/repetition/50-move, 24 h move
  clock, elo, color assignment, replays). Also exposes `chessRules` for the
  client's move highlighting — one file, one source of truth.
- `index.html`, `app.js`, `game.js`, `net.js`, `ui.js`, `style.css` — the
  static client (no build step): main menu (play via elo matchmaking, rejoin up
  to 20 concurrent games, friends top-10 elo leaderboard, recent replays,
  friend invites), game view (board, SAN move list, chat, opt-in voice via
  WebRTC — off by default per game), replay viewer.
- `starhermit.txt` — the game manifest the platform reads when this repo is
  added as a game: `name`, `launch` (HTML entry point), `owner` (the owning
  Starhermit account — username or user id), and `server` (the repo file the
  backend runs as the authoritative server script, i.e. `server.js`).
- `API.md` — the REST/WebSocket contract against the starhermit platform
  (games subsystem, chat, voice, leaderboards, game-scoped launch tokens).
- `deploy.sh` — registers the game + budgets on the platform via the
  starhermit admin backend and uploads `server.js`.
- `dev/mock-server.mjs` — dev-only smoke server that stubs the platform and
  hosts the real `server.js` so the UI can be driven without a backend.

## Rules of engagement (game design)

- Matchmaking pairs the nearest-elo queued players; elo starts at 1200, K=32,
  tracked server-side from game results only.
- Colors: random on a pair's first game, then strictly alternating.
- 24 h per move. Timing out loses — unless **no move was ever made** in the
  game, which scores as a draw.
- Up to 20 concurrent games per player (platform-enforced).
- Chat works between any two matched players; voice chat is opt-in and starts
  disabled for every new game.

## Running locally

```bash
# 1. Start the starhermit stack (API on :5050) and the admin backend (:5040)
# 2. Register + deploy the game script:
./deploy.sh
# 3. Serve this directory statically (any file server) and open index.html.
#    Launched by the platform it receives #game_token=...; opened bare it shows
#    a dev panel where a user JWT can be pasted (it then mints its own
#    game-scoped launch token via POST /api/v1/games/chess/launch-token).
```

Engine tests: `node <scratch>/test-server.js` covers movement legality, pins,
castling/en-passant edge cases, promotions, mates/stalemates/repetition,
timeouts, elo math, color alternation — plus perft(1..4) exact node counts.

## Budgets & abuse control (platform side)

Admins control, per game, via the admin dashboard/API: per-player state budget
(default 5 MB), CPU ms / memory / statement budgets per script invocation, and
concurrent-session caps. The platform meters every invocation (avg/peak
processing ms) so a malicious or runaway game script is visible and can be
throttled by tightening its budgets.
