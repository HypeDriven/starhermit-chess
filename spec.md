# StarHermit Chess — running specification

> **This is the running specification: it describes what this game does today.** It is loaded into
> every Claude Code session at start. Any task that changes behaviour must update this document in the
> same change — see [Keeping this document current](#keeping-this-document-current).

Multiplayer correspondence chess on the StarHermit platform, and the platform's **reference
implementation of a scripted game**: its entire rules authority lives in one server-side JavaScript
file that the platform runs in a sandboxed, budgeted engine. Clients send commands; the platform runs
each through the script and relays only what the script explicitly returns — so a client cannot cheat,
spoof identity, or move out of turn.

Its shape is the template other games copy: a `starhermit.txt` manifest, a static no-build browser
client, and — for multiplayer or server logic — a single authoritative `server.js`. `API.md` documents
the client-facing platform contract this game speaks.

## Files

| File | What it is |
|---|---|
| `starhermit.txt` | The manifest the platform reads when the repo is added: `name`, `launch` (HTML entry point), `owner`, and the optional `server` (the repo-relative file run as the authoritative script). There is **no slug key** — the platform assigns a uid and uses it as both the slug and the `<uid>.starhermit.com` address, so two games can never contend for a name. |
| `server.js` | The single authoritative game script: full chess rules (castling, en passant, promotion, mate, stalemate, repetition, 50-move), the 24 h move clock, elo, colour assignment, replays. It also exposes `chessRules` to the client for move highlighting — one file, one source of truth. |
| `index.html`, `app.js`, `game.js`, `net.js`, `ui.js`, `style.css` | The static client, no build step. |
| `starfield.js`, `vendor/`, `assets/chess-pieces.glb` | The main menu's three.js backdrop: a starfield with drifting 3D chess pieces. Lazy-loaded when the menu first shows, skipped with a console note when WebGL is absent. Piece models from `mrabhin03/3D-Chess-Game` (MIT), repacked 4.3 MB → 0.37 MB (`vendor/ATTRIBUTION.md`). |
| `API.md` | The platform REST/WebSocket contract the client speaks: games subsystem, chat, voice, leaderboards, launch tokens. |

## Client

- **Main menu** — play via elo matchmaking, rejoin any of up to 20 concurrent games, a friends top-10
  elo leaderboard, recent replays, and friend invites.
- **Game view** — board, SAN move list, chat, and opt-in voice over WebRTC (off by default for every
  new game).
- **Replay viewer** — a finished session's state document is the replay.
- **Pieces are inline SVG**, not the Unicode chess glyphs: those render from whichever font the
  platform picks, and the pawn's codepoint is also an emoji, so iOS painted it from the emoji font
  in a fixed colour that ignored the side it belonged to. Vectors take their fill from CSS, so each
  player sees their own colour on every platform.
- The client is **slug-agnostic**: it reads its slug from the launch token's `game_scope` claim, so
  nothing is tied to one deployment. Launched by the platform it receives `#game_token=…` and signs in
  automatically; opened directly it shows a panel for a user token, a game slug and an optional API
  base URL.

## Rules of engagement

- Matchmaking pairs the nearest-elo queued players. Elo starts at 1200, K=32, and is tracked
  server-side from game results only. The server AI, **hal**, carries the same persistent elo and
  record as any human.
- Colours are random on a pair's first game, then strictly alternating.
- 24 h per move. Timing out loses — unless no move was ever made in the game, which scores as a draw.
- Up to 20 concurrent games per player (platform-enforced).
- Chat works between any two matched players; voice is opt-in and starts disabled for every new game.

## Publishing

There is no deploy script and no special tooling. A player adds the game from the StarHermit client
(**Add game** → paste the GitHub repo URL); the platform reads `starhermit.txt` at the repo root to
identify the owner and the optional server script and stands the game up. Publishing is pushing to
GitHub and adding the repo. The submitter can then choose **Deploy to StarHermit**, after which the
platform clones the repo and serves it at the game's `<uid>.starhermit.com` origin so it also runs in
the web dashboard; the live version is controlled by pinning a commit. Because the game is served from
its own subdomain with `/api` and `/ws` proxied same-origin, the client needs no CORS and no API-base
configuration in production.

## Sandbox and budgets

The platform runs `server.js` in an isolated sandbox with per-game resource limits — a per-player state
budget (5 MB by default), CPU / memory / statement ceilings per script call, and a concurrent-session
cap — and meters each invocation's processing time. The repo neither configures nor depends on any of
those; it just writes correct, bounded game logic.

The one platform knob the script does set is its tick rate: `server.js` declares `tickRateHz: 1`, so
the platform calls `onTick` about once a second. That is all a 24 h move deadline needs — though a
script that declares nothing is ticked at the platform's slow default of 0.25 Hz, so the declaration
buys promptness rather than rescuing the deadline. The value is a request: the platform clamps it to
the game's operator override and the global maximum.

`server.js` also declares `replays: true`, which is what makes the platform keep each finished
session's final state; it keeps none for a game that does not ask. That archived state is what the
replay viewer steps through, so the declaration is the feature. Like the tick rate it is a request
an operator may answer either way, and `GET /api/v1/games/chess` reports the answer as
`replaysEnabled`.

## Local development

Serve this directory with any static file server and open `index.html`.

## Keeping this document current

**Every task that changes observable behaviour updates this file as part of the same change** — a rules
change, a new client screen, a change to the manifest, a change to which platform features the game
uses. A change is not done until the spec matches it.

1. Present tense, shipped behaviour only — no roadmap.
2. This game is the platform's reference implementation: when the platform contract changes under it,
   fix `API.md` and this file together, and check `../starhermit/spec.md` and
   `../starhermit-developer-wiki` agree.
3. Edit in place, don't append a changelog; delete what stopped being true.
