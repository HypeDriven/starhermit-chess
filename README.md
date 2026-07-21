# Chess — multiplayer correspondence chess on Starhermit

A reference implementation of a Starhermit game. Its entire rules authority
lives in **one server-side JavaScript file** (`server.js`) that the platform
runs in a sandboxed, budgeted engine. Clients send commands; the platform runs
each through the script and relays only what the script explicitly returns — so
clients can't cheat, spoof identity, or move out of turn.

Use this repo as a template for your own Starhermit game: keep the shape
(a `starhermit.txt` manifest, a static browser client, and — if your game needs
multiplayer or server logic — a single authoritative `server.js`), and replace
the chess-specific parts.

## How a game gets onto the platform

There is no deploy script and no special tooling. A player adds the game from
the Starhermit client — **Add game → paste the GitHub repo URL** — and the
platform reads `starhermit.txt` at the repo root to identify the owner and the
optional server script, then stands the game up. Publishing is just pushing to
GitHub and adding the repo.

When the submitter is the **verified owner**, the platform clones the repo and
**serves the game itself at `<slug>.starhermit.com`** (so it runs in the web
dashboard, not just the desktop client). The owner controls which version is
live by pinning a **commit** in the game's details — the platform re-fetches the
repo at that commit and serves it. The game's `/api` and `/ws` calls are proxied
same-origin from its subdomain, so this client needs no CORS or API-base
configuration.

## Files

- `starhermit.txt` — the manifest the platform reads when the repo is added:
  `name`, `slug` (the game's URL-safe id on the platform), `launch` (HTML entry
  point), `owner` (the owning Starhermit account — username or user id), and the
  optional `server` (the repo-relative file run as the authoritative server
  script). Omit `server` for a game with no server-side logic.
- `server.js` — the single authoritative game script (chess rules incl.
  castling/en passant/promotion/mate/stalemate/repetition/50-move, 24 h move
  clock, elo, color assignment, replays). Also exposes `chessRules` for the
  client's move highlighting — one file, one source of truth.
- `index.html`, `app.js`, `game.js`, `net.js`, `ui.js`, `style.css` — the
  static client (no build step): main menu (play via elo matchmaking, rejoin up
  to 20 concurrent games, friends top-10 elo leaderboard, recent replays,
  friend invites), game view (board, SAN move list, chat, opt-in voice via
  WebRTC — off by default per game), replay viewer. The client is slug-agnostic:
  it reads its slug from the launch token, so nothing here is tied to one
  deployment.
- `API.md` — the platform REST/WebSocket contract the client speaks (games
  subsystem, chat, voice, leaderboards, game-scoped launch tokens).
- `starfield.js`, `vendor/`, `assets/chess-pieces.glb` — the main menu's
  three.js backdrop: the classic starfield with drifting 3D chess pieces
  instead of stars. Lazy-loaded when the menu first shows, skipped (with a
  console note) without WebGL. Piece models from
  [mrabhin03/3D-Chess-Game](https://github.com/mrabhin03/3D-Chess-Game) (MIT),
  repacked from 4.3 MB to 0.37 MB — see `vendor/ATTRIBUTION.md`.

## Rules of engagement (game design)

- Matchmaking pairs the nearest-elo queued players; elo starts at 1200, K=32,
  tracked server-side from game results only.
- Colors: random on a pair's first game, then strictly alternating.
- 24 h per move. Timing out loses — unless **no move was ever made** in the
  game, which scores as a draw.
- Up to 20 concurrent games per player (platform-enforced).
- Chat works between any two matched players; voice chat is opt-in and starts
  disabled for every new game.

## Local development

Serve this directory with any static file server and open `index.html`.
Launched by the platform the game receives `#game_token=…` and signs in
automatically; opened directly it shows a panel where you enter a user token,
the game slug, and (optionally) an API base URL to point at a running platform.

## Sandboxing & resource budgets

The platform runs `server.js` in an isolated sandbox and applies per-game
resource limits with sensible defaults — per-player state budget (5 MB), CPU /
memory / statement ceilings per script call, and a concurrent-session cap — and
meters each invocation's processing time. A game repo neither configures nor
depends on any of this; it just writes correct, bounded game logic.
