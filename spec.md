# StarHermit Chess — running specification

> This is the running specification: it describes what the game does today, in the present tense.
> Any change to observable behaviour updates this file in the same change. Design the code does
> not yet do is listed only under [Design intent not yet implemented](#design-intent-not-yet-implemented).

## 1. Overview

**Pitch.** Correspondence chess in a quiet club room: one move a day against a rated opponent,
with the platform's sandboxed script as the only referee — and a practice board against *hal* that
needs no sign-in at all.

| | |
|---|---|
| Genre | Two-player abstract strategy (standard FIDE chess), asynchronous / correspondence |
| Players | 2 per game (human vs human, or human vs the server AI **hal**); up to 20 concurrent games per player |
| Session length | Offline practice: 5–15 minutes. Online: one move per sitting, a game spans days to weeks (24 h per move) |
| Platforms | Desktop and mobile browsers; launched from the StarHermit client or served at `<uid>.starhermit.com` |
| Rendering | DOM/CSS grid board, inline-SVG pieces (`UI.PIECE`). Three.js is used only for the main-menu backdrop |
| Build | None. Static files, no bundler, no framework |

**File map.**

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Platform manifest: `name`, `launch=index.html`, `owner`, `server=server.js`, `cover=coverart.png`. No slug key: the platform assigns a uid |
| `index.html` | All four screens as `<section class="view">` plus shared chrome (toasts, modal, top bar, landing key art) |
| `server.js` | The authoritative game script (rules, clock, Elo, colours, hal) run by the platform; also loaded by the browser as `globalThis.chessRules`; doubles as a local static server under Node |
| `app.js` | Boot/auth, the club menu (matchmaking, sessions, leaderboard, invites, replays), the replay viewer, view switching |
| `game.js` | `GameController` (game socket, board interaction, chat) and `VoiceController` (WebRTC voice) |
| `local.js` | `LocalGame`: the offline practice game against hal, same rules and same greedy AI, no platform |
| `ui.js` | DOM helpers, toasts, modal, SVG pieces, board renderer with keyboard navigation, scoresheet, 1 s ticker |
| `net.js` | Token lifecycle, REST and WebSocket plumbing, slug from the launch token's `game_scope` |
| `audio.js` | `Sfx`: clip-per-event sound effects from `sfx/manifest.json`, mute toggle |
| `starfield.js` | Menu backdrop: drifting instanced 3D chess pieces (three.js, lazy-loaded, WebGL optional) |
| `style.css` | The whole look: palette tokens, board, panels, responsive rules |
| `assets/` | `key-art.webp` (landing backdrop), `chess-pieces.glb` (starfield geometry) |
| `sfx/` | 14 Opus clips, `manifest.txt` (canonical table), `manifest.json` (generator binding), `manifest.md` (generated) |
| `coverart.png`, `icon.png`, `favicon.svg` | Library tile, favicon/wordmark mark |
| `vendor/` | three.js r176dev build, `GLTFLoader`, `BufferGeometryUtils` (MIT, `vendor/ATTRIBUTION.md`) |
| `tests/` | `rules.mjs` (rules + script entry points), `e2e.mjs` (headless Chrome playthrough). Dev only, never shipped |
| `API.md`, `README.md` | The platform contract the client speaks; repo readme |

## 2. Vision and design pillars

1. **One file is the referee.** `server.js` is the only authority on legality, results, colours and
   Elo, and the browser loads *that same file* for move highlighting and replay stepping. Rules in:
   identical legal-move dots online and offline; the replay is a re-run of the move list. Rules out:
   any client-side rules copy, any client-reported result, any trust in the payload's identity.
2. **One move a day.** The game is paced like a letter, not a blitz clock. Each move hands the
   opponent a fresh 24 h; the fuse under the clock drains over the day and turns red in the last hour.
   Rules in: a menu that sorts games by "your move" and deadline, a warning cue at the last hour.
   Rules out: increments, live timers, anything that rewards being online at the same time.
3. **A quiet club room.** Walnut, ivory, brass and paper; a lined scoresheet that fills as you play;
   sounds that are wood on wood and a small bell. Rules in: serif headings, tabular numerals, a
   single brass accent. Rules out: confetti, neon, score pop-ups, music.
4. **Every seat is rated — hal's too.** The server AI carries the same persistent Elo and record as
   any member, sits in the same leaderboard, and is offered after 30 s of unmatched queueing so a
   player always has a rated game to play. Rules in: hal games count. Rules out: a separate
   "casual" ladder online (the only unrated board is the offline practice game).
5. **The board takes any hand.** Pointer, touch and keyboard all play the same board: squares are one
   roving tab stop, every square is labelled "e4, white pawn", pieces are vectors so both colours
   render correctly on every platform. Rules out: drag-and-drop as the only input, Unicode glyph
   pieces, hover-only affordances.

## 3. Player experience

**Target player.** Someone who likes chess and has fifteen minutes here and there — the commuter
who answers three games over coffee — plus anyone who wants a board to poke at with no account.

**First 60 seconds.** The landing screen ("Take a seat") has one primary button, **Play**, under
the sentence "Practice against hal right now — no sign-in needed." Pressing it opens the board in
a random colour. The clock card says "Your move" or "hal to move"; if hal is white it replies within
0.45–0.95 s. Tapping one of your pieces rings it in brass and drops a dot on every legal
destination (a ring on captures); tapping a dot plays the move and the scoresheet gains a SAN entry.
The game teaches by affordance rather than text: the dots *are* the rules, the last move stays
tinted, "Check" appears in italics beside your seat when your king is attacked, the promotion picker
appears over the board only when a pawn reaches the last rank. There is no tutorial screen; the
learning surface is the legal-move highlighting and the toasts ("Illegal move.", "hal declines the
draw.").

**Session shape.** Offline: a full game against a greedy opponent, usually ending in mate or
resignation within 20–40 moves. Online: sign in → the club menu lists your games sorted "your move"
first, then by nearest deadline → open one, play one move, read the table talk, back to the club →
repeat, or press Play to queue for a new opponent. Finished games land in "Recent games" with a
rating delta and open in the replay viewer.

**Emotional beat.** The satisfying *knock* of a piece landing on wood and the quiet certainty that
the referee cannot be argued with — then the small bell when a check lands.

## 4. Core loop and rules contract

All rules live in `server.js`; function names below are from that file unless stated.

**Board and state.** `newGameState()` returns `{ board, turn, castling{K,Q,k,q}, epSquare,
halfmoveClock, fullmove, moves[], positionCounts{}, status }`. `board` is a 64-character string,
index = rank×8 + file, `a1` = 0, `PNBRQK` white, `pnbrqk` black, `.` empty. The opening position is
counted once in `positionCounts` (`positionKey()` = board + turn + castling rights + ep square).

**Legal actions** (`legalMovesFrom(g, from)` → `allLegalMoves(g)`): pseudo-moves from
`pseudoMovesFrom` filtered by `inCheck` on the resulting board (`applyMoveToBoard`); promotions are
expanded into four moves (q, r, b, n). Castling requires king on its home square (file e) and rook
rights intact, empty squares between, and the king neither in check nor passing through or landing
on an attacked square (`isAttacked`). En passant is offered only onto `g.epSquare` set by the
previous double push. Rights are removed when a king moves or a rook moves from or is captured on its
corner (`applyMoveToBoard`).

**Resolution order for one move** (`makeMove(g, {from,to,promo}, now)`):
1. Parse squares (`Malformed square.`), validate promo (`Invalid promotion piece.`).
2. Find the request among the legal moves; a promotion without a piece is refused with
   `Promotion piece required (q, r, b or n).`, anything else with `Illegal move.`
3. Apply; compute check and mate on the post-move board; build SAN against the pre-move board
   (`sanFor`: file, then rank, then full-square disambiguation; `O-O`/`O-O-O`; `=Q`; `+`/`#`).
4. Update clocks: `halfmoveClock` resets on pawn moves and captures; `fullmove` after black.
5. Append `{from,to,promo,san,at}` to `moves`, count the new position.
6. Terminal checks, in this order: checkmate → stalemate → threefold repetition (count ≥ 3) →
   fifty-move rule (`halfmoveClock ≥ 100`) → insufficient material (`insufficientMaterial`: K v K,
   K+minor v K, K+B v K+B with same-coloured bishops). Draws are automatic, never claimed.

**Server-side command handling** (`game.onPlayerMessage`): sender identity comes from the host, not
the payload. `sync` returns the view to the sender only. On an active game: `move` (turn checked:
`Not your turn.`) clears any draw offer and sets `deadline = now + 24 h`; `resign` ends the game for
the opponent; `offer-draw` records `drawOfferBy`, a second offer from the other side is an agreement,
hal declines instantly and records nothing; `accept-draw` / `decline-draw` require a live offer from
the other colour. Unknown commands are refused. Only what the script returns in `broadcast` is
relayed.

**Move clock** (`game.onTick`, `tickRateHz: 1`): when `now ≥ deadline` on an active game, the side
to move loses on time (`timeout`) — unless no move has ever been played, in which case the game is a
draw (`timeout-no-moves`). Both outcomes are rated.

**Colours** (`game.createSession`): first meeting of a pair is decided by the host-supplied
`ctx.random < 0.5`; every later game between the same two alternates, remembered per player in
`lastColorVs` (LRU of 200 opponents). Sessions against hal are random every time. A session needs
exactly two distinct players. Offline (`LocalGame`), the human's colour is `Math.random() < 0.5`.

**hal** (`greedyPick(g, seed)`): one-ply material greed — score a move by the captured piece's value
(p1 n3 b3 r5 q9) + 1 for en passant + (promotion value − 1); ties broken by a small LCG seeded from
the host's per-invocation random, so a given invocation is deterministic. `aiReply` plays hal's move
inside the same invocation as the human's, and opens immediately when hal is white.

**Rating** (`finishGame` → `eloAfter`): Elo with K = 32, start 1200, rounded to integers, applied
to both player documents with wins/losses/draws counters and a `recentGames` summary (last 30).
Expected score `E = 1 / (1 + 10^((b − a)/400))`; new rating `a + 32·(S − E)`.
Worked example — white 1300, black 1200, draw: `E_white = 1/(1+10^(−0.25)) = 0.640`;
white → `1300 + 32·(0.5 − 0.640) = 1295.5 → 1296`; black → `1200 + 32·(0.5 − 0.360) = 1204.5 → 1204`.
Two 1200s: the winner becomes 1216, the loser 1184. The result record carries `eloBefore`/`eloAfter`
by user id so the menu can show `+16` / `−16`.

**Terminal states.** `result.kind ∈ {white, black, draw}`, `result.reason ∈ {checkmate, stalemate,
threefold-repetition, fifty-move-rule, insufficient-material, resignation, agreement, timeout,
timeout-no-moves}`. There are no tie-breaks beyond a draw being a draw.

**Undo and hints.** No undo, online or offline. The only hint is the legal-destination dots for the
selected piece; there is no engine advice.

**Offline practice differences** (`local.js`): unrated, no 24 h clock (fuse stays full), no chat, no
voice, no replay afterwards, draw offers are declined by hal with a toast. Everything about
legality and game end is the same `chessRules`.

## 5. Modes and progression

| Mode | Entry | What differs |
|---|---|---|
| Offline practice vs hal | Landing screen → **Play** (no sign-in) | `LocalGame`; unrated; no clock; no chat/voice/replay; "Back to the club" returns to the landing screen |
| Rated matchmaking | Club → **Play** | `POST /matchmaking`; nearest-Elo pairing; polled every 3 s; after 30 s in the queue a **Play against hal** button appears (the 30 s belong to the ticket, and survive a reload) |
| Rated game vs hal | Matchmaking → **Play against hal** | `POST /sessions/ai`; server-side hal; 24 h clock applies; hal's own Elo is shown on its seat; chat disabled, voice panel hidden |
| Friend invite | Club → **Invite a friend** | Picker of platform friends (profile nickname + avatar); accepting creates the session immediately |
| Share link | Club → **Share invite link** | Copies `https://dashboard.starhermit.com/game-invite/<userId>/<slug>`; the dashboard friends the recipient and sends the play invite back |
| Rejoin | Club → "My games" card | Opens the session; cards show "your move"/"their move" and time left, urgent under 1 h |
| Replay | Club → "Recent games" card, or **View replay** on the game-over card | Read-only board stepped from the archived move list |

Difficulty comes from the opponent, not the mode: hal is a fixed one-ply greedy player, humans are
matched by nearest Elo. There are no unlocks, no daily puzzles and no seeded content. Progression is
the Elo number in the top-right chip, the "My rating" card (rating, won/lost/drawn) and the
friends-only top-10 table.

## 6. Controls and interaction

| Input | Desktop | Touch | Effect |
|---|---|---|---|
| Select piece | Click own piece | Tap | Brass inset ring; legal destinations dotted (rings on captures); `select` sound |
| Play move | Click a dotted square | Tap | Move sent (`sendMove`) / applied (`applyMove`); selection cleared |
| Reselect / deselect | Click another own piece / any other square | Tap | New candidates, or selection cleared |
| Promotion | Click a piece in the picker | Tap | Four buttons over the board in your colour; Escape or backdrop tap cancels, leaving the pawn selected |
| Board by keyboard | Tab to the board, ←↑→↓ between squares, Home/End along the rank, Enter/Space to select or play | — | `UI._boardKey`; focus survives the re-render |
| Draw / Resign | Buttons under the board | Same | Confirm modal (`UI.confirm`); Enter confirms, Escape cancels |
| Accept / decline draw | Banner buttons | Same | Only shown to the side that did not offer |
| Chat | Type + Enter / Send | Same | Disabled against hal and offline |
| Voice | **Enable voice**, **Mute** | Same | Microphone permission prompt; hidden against hal |
| Replay | ◀ ▶ ⏮ ⏭ buttons, ← → Home End keys, click a move on the sheet | Tap | Forward steps sound the move |
| Sound | **Sound on/off** in the top bar | Same | Mutes all effects; remembered in `localStorage` |

**Input locking.** Square clicks are ignored unless `myTurn()` (active game and my colour to move).
While the promotion picker or the modal is open, board keys do nothing (the picker captures Escape;
the modal swallows replay keys). After game over, Resign and Offer draw are disabled and the game-over
card covers the board. Draw is also disabled while my own offer is pending. Two quick taps on a
square never zoom: `touch-action: manipulation` on buttons, squares and sheet moves.

**Feedback for every input.** Selection ring; destination dots; last-move tint on both squares;
red radial glow on a king in check plus the italic "Check" flag; toast for any rejected command
(`illegal` knock); "Not connected — retrying…" toast when the socket is down; `conn-state` note
("connecting…", "reconnecting…", "offline practice"); sounds per §9.

## 7. Screens and UI flow

`App.showView(name)` toggles one of four `<section class="view">` elements; `_onLeave` tears down the
previous screen's timers.

```
auth ──Play──▶ game(local) ──Back/Game over──▶ auth
auth ──token──▶ menu ──card/Play/Accept──▶ game(online) ──Back──▶ menu
                 menu ──Recent games──▶ replay ──Club──▶ menu
                 game ──View replay──▶ replay
                 any ──401 / refresh failure──▶ auth (with a message)
```

Launch with `#game_token=…` skips auth (and `&session_id=` opens that game directly). A valid token
in `sessionStorage` also skips it.

**Landing (auth).** Key art fills the viewport behind a 460 px card: "Take a seat", the Play button
and hint, a divider, then the developer fields (user JWT, game slug, API base) and "Enter the club".

**Club (menu).** Desktop: two columns, `minmax(0,1fr) 320px`. Main: Play row, "My games" (n of 20
seats), "Invitations" (Share invite link, Invite a friend). Side: "My rating", "Friends table",
"Recent games". The starfield canvas sits behind everything at z-index 0.

**Game.** Desktop: `minmax(0,1fr) 340px`. Board column: opponent seat (presence lamp, name, Elo,
colour), the board (`min(100%, 100vh − 300px, 640px)` wide), my seat with the Check flag, clock card
with fuse, draw banner, action row (← Club, Offer draw, Resign). Side column: Scoresheet, Voice,
Table talk. The promotion picker and the game-over card are absolutely positioned inside the board
wrap so they can never fall outside it.

**Replay.** Same grid: seats, board, result line ("Alice won — checkmate", both ratings after), the
stepping controls and the clickable scoresheet ("12 / 37" ply counter).

**Responsive.** ≤ 940 px: single column everywhere; board and its row widgets are
`min(100%, 92vw, max(300px, 100dvh − 230px))` so a landscape phone still fits the board plus the
action row; scoresheet capped at 200 px; inputs 16 px to stop iOS zoom; modal body 55dvh. ≤ 600 px:
top bar padding honours `env(safe-area-inset-top)`, the Play row stacks and the button goes full width.
`pointer: coarse` grows buttons, sheet rows (34 px) and cards. Portrait phones get a 120-piece
starfield instead of 210.

**Must never be cut off.** All 64 squares with their coordinates, the clock line, the Resign/Offer
draw buttons, the promotion picker, the game-over card (max 88 % of the board width), the toast stack
(bottom 18 px, ≤ 92vw on phones) and the modal buttons.

## 8. Art direction

**Palette** (`style.css` `:root`):

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#171310` | Page, fog colour of the starfield |
| `--panel` / `--panel-2` | `#201a15` / `#29211a` | Cards, buttons, scoresheet paper |
| `--line` / `--line-soft` | `#3a2f24` / `rgba(236,225,204,.10)` | Borders, sheet ruling |
| `--ink` / `--muted` / `--faint` | `#ece1cc` / `#a4926f` / `#6f6250` | Text hierarchy |
| `--brass` / `--brass-hi` / `--brass-ink` | `#c8a35f` / `#e2c17e` / `#1c150e` | The single accent: primary buttons, Elo, focus ring, selection |
| `--sq-l` / `--sq-d` | `#d5bd92` / `#7c5a3e` | Light and dark squares; board frame `#241a11` |
| White / black pieces | `#f6ecd8` line `#2a1c10` / `#26190f` line `#e7dbc0` | SVG fill and outline |
| `--ok` / `--danger` | `#8caf78` / `#c9674f` | Presence lamp, rating up; check glow, resign, urgent clock |
| Starfield materials | ivory `0xd9c9a3`, walnut `0x5a4330`, key light `0xe2c17e` | Three.js |

**Shape language.** 6 px radii, 1 px lines, a 6 px board frame, the six pieces drawn on one 45×45
grid sharing a plinth (`UI.PLINTH`) so they read as one carved set. Cards are flat panels; the only
glow is the presence lamp and the check radial.

**Typography.** Headings, seat names, scoresheet, Elo and the wordmark use the serif stack
(`Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif`); body and controls use
the system sans. Numerals are tabular everywhere a number changes. The wordmark is letter-spaced
small caps.

**Motion.** Border/background transitions 120 ms, toast entry 160 ms, the searching pulse 1.4 s, the
fuse width eases over 1 s each tick, the starfield drifts pieces toward the camera at 3.9–8.8 units/s
with a slow tumble. `prefers-reduced-motion` collapses every CSS animation and transition to 0.01 ms.
The starfield is skipped entirely when WebGL, import maps or the model are unavailable (a console
note, nothing else).

**Hero.** The board. Everything else is paper and brass around it; on the landing screen the hero is
the key art (a lamp-lit board in a club library) that the real board then echoes.

**Visual assets the design calls for.** Landing key art (`assets/key-art.webp`), the cover tile
(`coverart.png`, the same art with the title), the wordmark mark (`icon.png`, `favicon.svg`), the six
piece geometries for the starfield (`assets/chess-pieces.glb`). No further textures: squares are flat
colour by design.

## 9. Audio direction

**Mix philosophy.** Dry, close-miked and small: wood on wood, a fingertip on a table, one brass bell.
No music and no ambience — the room is silent so that a piece landing is an event. Every clip is
loudness-normalised to −20 LUFS and under three seconds. One effects bus; the **Sound** button in
the top bar mutes it (persisted as `chess.muted`). `audio.js` binds file → event from
`sfx/manifest.json`; a missing clip or a refused autoplay is silent, never an error. Move cues are
derived from SAN (`Sfx.forMove`): `=` promote, `O-O` castle, `x` capture, otherwise move, plus the
bell when the SAN ends in `+` or `#`.

**SFX event table** (source of `sfx/manifest.txt`):

| Event id | File | Sound | Usage context |
|---|---|---|---|
| `select` | `piece-select.opus` | A wooden piece lifted off the board, one light dry tap with a faint slide | Own piece selected (`clickSquare`, online and offline) |
| `move` | `piece-move.opus` | A wooden piece set down gently, one soft solid knock with warm resonance | Any quiet move landing, either side; forward step in the replay viewer |
| `capture` | `piece-capture.opus` | A piece knocking another off the board, a firm double clack with a small tumble | Capture landing (SAN contains `x`) |
| `castle` | `piece-castle.opus` | Two pieces set down in quick succession, two soft knocks a beat apart | `O-O` / `O-O-O` |
| `check` | `check-bell.opus` | A single small brass bell, clear short ting with a decaying ring | Layered on any move whose SAN ends in `+` or `#` |
| `promote` | `promote-chime.opus` | A short ascending glockenspiel triplet ending on a sustained note | Promotion landing (SAN contains `=`) |
| `illegal` | `illegal-knock.opus` | A dull muted knuckle knock on a tabletop, two damped taps | Server `error` frame; offline move refused |
| `matchFound` | `match-found.opus` | A hotel desk bell struck once in a quiet carpeted room | Matchmaking ticket became `matched` |
| `drawOffer` | `draw-offer.opus` | Two light polite fingertip taps on a polished table | Opponent's `draw-offered` frame |
| `chat` | `chat-note.opus` | A folded note slid across a table, a soft paper swish and a faint tick | New table-talk message from the opponent after history loaded |
| `clockWarning` | `clock-warning.opus` | A single mechanical chess-clock tick and a muted wooden click | Once per game view when my own clock first shows under one hour |
| `win` | `game-win.opus` | A warm rising brass-and-clarinet phrase resolving into a bright major chord | Game-over card, I won |
| `lose` | `game-lose.opus` | Three slow descending soft piano notes fading to silence | Game-over card, I lost |
| `draw` | `game-draw.opus` | Two soft equal piano notes held together, a suspended chord fading | Game-over card, drawn |

Voice chat (WebRTC, `VoiceController`) is a separate opt-in channel, off for every new game, with
speaking and mute indicators per peer; it is not mixed with effects.

## 10. Localization

**Ships today: English only** (`<html lang="en">`; US spelling in copy, e.g. "color" is not used
in UI text, "Practice" and "Scoresheet" are). Strings live inline: markup copy in `index.html`,
dynamic copy as literals in `app.js`, `game.js`, `local.js` and `ui.js` (result reasons in
`showGameOver` / `LocalGame.finish`, toasts, seat labels, square labels in `UI.squareLabel`). Dates
and times already follow the browser locale (`toLocaleDateString(undefined, …)`,
`toLocaleTimeString`). Chess notation (SAN, `O-O`) is locale-invariant by design.

The product target is en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT, chosen from
`navigator.languages` with a persisted override; German and French strings need ~30 % width
allowance on buttons ("Offer draw", "Enter the club") and the seat/colour labels. None of this is
implemented — see [Design intent](#design-intent-not-yet-implemented).

## 11. Accessibility

- **Keyboard-only path.** Landing → Play (button) → Tab to the board → arrows / Home / End move
  focus, Enter or Space plays the focused square → promotion buttons are focusable, Escape cancels →
  Offer draw / Resign → modal (OK is focused on open, Escape cancels) → game-over buttons. Replay:
  ← → Home End. The board is one roving tab stop (`UI._boardFocus`), and focus survives the full
  re-render every move causes.
- **Focus.** `:focus-visible` draws a 2 px brass outline with 2 px offset on every control.
- **Screen readers.** Every square is `role="button"` with `aria-label` "e4, white pawn" (or
  `role="img"` in the replay); the promotion picker is `role="dialog"`; the modal is
  `aria-modal` labelled by its text; toasts live in an `aria-live="polite"` region; the presence lamp
  has an `aria-label` ("Opponent online"); the starfield and key art are `aria-hidden`.
- **Contrast.** Ink on background 13.5:1, muted 6.1:1, brass on background 7.4:1, brass-ink on brass
  9.6:1. `--faint` text (13 px notes, hints) is 3.1:1 — below AA for small text (known limitation).
- **Reduced motion.** All animations and transitions collapse under `prefers-reduced-motion`.
- **Target sizes.** Buttons are ≥ 40 px tall on coarse pointers; sheet rows 34 px; squares are
  board-width/8, i.e. ≥ 37 px on a 300 px board and 44 px+ from 352 px up.
- **Colour is never the only signal.** Check has the text flag as well as the glow; urgent time turns
  red *and* reads "0h 42m left"; captures use a ring shape, not just a colour.

## 12. StarHermit integration

Conventions per https://wiki.starhermit.com/ ; endpoints are listed in `API.md`.

| Platform feature | Used | How |
|---|---|---|
| Identity / launch token | Yes | `#game_token` from the launcher or `POST /games/{uid}/launch-token` from the dev panel; slug from the `game_scope` claim; refreshed every 45 min (`Net.startRefresh`) |
| Profiles and avatars | Yes | `GET /users/{id}/profile` (nickname; usernames never shown) and `/avatar`, cached per session (`App.profileFor`) |
| Presence | Yes | `presence` frames on the game socket light the opponent's seat lamp; hal is always lit |
| Sessions | Yes | `/sessions/mine`, `/sessions/{id}`, `/sessions/ai`; cap of 20 read from `maxConcurrentSessionsPerPlayer` |
| Matchmaking | Yes | `POST/GET/DELETE /matchmaking`, ticket resumed across reloads |
| Invitations | Yes | `/invites` list/send/accept/decline; friends from `/me/friends`; dashboard share URL |
| Leaderboard | Yes (read) | Friends-only top 10 from `leaderboardId`; the platform writes Elo from script results, the client never submits |
| Replays | Yes | `replays: true` declared; `/replays/mine`, `/replays/{id}`; archived `state.game.moves` re-run through `chessRules` |
| Chat | Yes | Per-session conversation from `chatConversationId`; REST history + send; push socket attempted twice then polling every 5 s (game tokens are fenced off the chat socket) |
| Voice | Yes (opt-in) | Rooms by conversation, join, `/ws/v1/voice` for `rtc` signalling, `voice.*` events |
| Server script | Yes | `server.js` via `starhermit.txt` `server=`; `createSession`, `onPlayerMessage`, `onTick`; `tickRateHz: 1`; per-player docs under the 5 MB budget |
| Achievements | No | Not declared |
| Cloud save beyond script state | No | The script's player document is the only persistent record |
| Spectating / tournaments | No | Replays are participant-only |

The client is slug-agnostic and origin-agnostic: in production `/api` and `/ws` are same-origin on
`<uid>.starhermit.com`; the dev panel can point `Net.base` elsewhere (persisted in `localStorage`).

## 13. Technical architecture

**Modules.** `net.js` (tokens, `api()`, `apiBlob()`, `wsUrl()`) → `ui.js` (pure DOM, no game
knowledge) → `audio.js` (`Sfx`) → `game.js` (`GameController`, `VoiceController`) → `local.js`
(`LocalGame`, same public surface: `start/destroy/resign/offerDraw/sendCmd/sendChat/myTurn`) →
`app.js` (`App`, wiring at the bottom). `server.js` loads first and exposes `chessRules`; its Node
static-server tail runs only under Node (`PORT=8000 node server.js`), never in the browser or the
platform sandbox. `starfield.js` is an ES module behind an import map and is fully independent.

**Determinism and replay.** The session document *is* the move list: the client rebuilds full rules
state (castling, ep, repetition) by replaying `view.moves` through `makeMove` (`replayMoves` in
`game.js`, `App.openReplay`). The script receives time and randomness only from `ctx.now` and
`ctx.random`, so an invocation is reproducible; hal's tie-breaks come from an LCG seeded by that
random. Offline practice uses `Math.random` and `Date.now()` and is not reproducible.

**Persistence.** `sessionStorage`: `chess.gameToken`. `localStorage`: `chess.apiBase`,
`chess.matchmaking.<slug>.<userId>` (ticket id + queued-at, so the 30 s hal offer survives a reload),
`chess.muted`. Server-side: per-player document (Elo, record, `lastColorVs` LRU 200,
`recentGames` 30) and the session document with its `summary` (turn, deadline, status, move count)
that the platform reads for the games list.

**Performance budgets.** No build, ~3,000 lines of client JS, one 0.37 MB model and 43 KB of key art.
The board re-renders 64 nodes with cloned SVG prototypes on every state change (sub-millisecond).
The starfield caps device pixel ratio at 1.5, uses one `InstancedMesh` per piece type and colour
(120 or 210 instances), clamps frame delta at 100 ms and stops its loop the moment the menu is not
the active view. Server invocations stay far under the 250 ms CPU / 32 MB sandbox limits: perft(3)
of the full generator runs in the tests in well under a second.

**How the e2e test drives the real UI.** `tests/e2e.mjs` starts its own static server (on `PORT` if
set, else ephemeral), launches system Chrome via `playwright-core`, and clicks the visible controls:
`#btn-play-local`, real `.sq` squares (waiting for the `.dest` dot before the second click), the
promotion button, `#btn-draw` and `#btn-resign` through the modal, `#go-menu`. It reads the game
state only to *choose* a legal move, never to make one. It runs at 1280×800 and again at 390×844 with
touch, fails on any `pageerror` or console error, and writes screenshots to `/tmp/chess-e2e-*.png`.

## 14. Testing and acceptance criteria

`npm test` = `npm run test:rules` then `npm run test:e2e`.

**`tests/rules.mjs`** loads `server.js` exactly as the browser does and checks: perft(1..3) =
20 / 400 / 8902; castling, en passant and promotion play and score as `O-O`, `exd6`, `b8=Q+`; SAN
disambiguation by file, rank and square; threefold repetition counts the opening position; fool's
mate `Qh4#`, a stalemate, K+N v K insufficient material; a game hal ends still publishes
`eloUpdates` and both player documents; resignation, draw agreement, `timeout` and
`timeout-no-moves` end games with the right winner; out-of-turn, illegal and malformed commands are
refused without recording anything; colours alternate for a pair; `tickRateHz` and `replays` are
declared; a one-player session is refused.

**`tests/e2e.mjs`** (desktop then mobile): landing visible → practice game opens with 64 squares,
opponent "hal", chat disabled → 4 (desktop) / 2 (mobile) move pairs by clicking, scoresheet count
equals moves → one move played from the keyboard alone with focus preserved across the re-render →
draw offer opens the modal and hal declines → resign through the modal shows "You lost / by
resignation" → back to the landing screen. Zero console errors (WebGL driver noise filtered).

**QA bar (checkable).**
- Every feature the UI exposes works in the browser without dev tools; the offline path needs no
  server at all.
- No console errors or warnings on the landing, practice game, game-over and back at 1280×800 and
  390×844 (verified by the e2e run).
- The board, clock line and action buttons are fully visible in portrait and landscape phone
  viewports; nothing sits under the top safe area.
- A new player gets guidance from the UI itself: legal-move dots, last-move tint, the Check flag,
  the "Practice against hal" hint and result reasons in words.
- All `node --check` passes on every `.js`/`.mjs`; `tools/audit_game_assets.py chess` passes
  (favicon links resolve, every clip is Opus 48 kHz mono and mapped to an event).

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1280×720, 43 KB) | Landing-screen backdrop | FLUX.2 klein, seed 7101, 1536×864, 28 steps | Generated in this pass |
| `coverart.png` (1200×675, 450 KB) | Library tile (`cover=` in `starhermit.txt`) | Same render + ffmpeg drawtext title/tagline, 256-colour PNG | Generated in this pass (replaced a generic placeholder) |
| `icon.png` (256×256), `favicon.svg` | Favicon, wordmark mark, platform library icon | Authored earlier | Shipped |
| `assets/chess-pieces.glb` (0.37 MB) | Six piece geometries for the menu starfield | mrabhin03/3D-Chess-Game (MIT), repacked | Shipped |
| `vendor/three.*`, `vendor/loaders/`, `vendor/utils/` | Renderer for the starfield | three.js r176dev (MIT) | Shipped |
| `sfx/piece-select.opus` … `sfx/game-draw.opus` (14 clips) | Effects per §9 | MOSS-SoundEffect v2.0, 100 steps, seeds derived from `chess___<name>` | Generated in this pass |
| `sfx/manifest.txt` | Canonical clip table | Hand-written from §9 | Generated in this pass |
| `sfx/manifest.json`, `sfx/manifest.md` | Generator binding; generated summary | Hand-written / tool output | Generated in this pass |
| 3D hero model, character animation | — | — | Not called for: the board is 2D and there is no character |

## 16. Known limitations

- English only; no locale switch (§10).
- The chat push socket is closed to game-scoped tokens, so opponent messages arrive on a 5 s poll.
- Opponent moves and check are not announced to screen readers as they happen; the user must
  re-read the board. The `Check` flag is visible text but not a live region.
- The starfield does not honour `prefers-reduced-motion` (only CSS motion does).
- `--faint` text is below AA contrast at 12–13 px.
- On a 300 px-wide board (the narrowest allowed) squares are 37 px, under the 44 px touch guideline.
- Offline practice cannot be replayed or resumed; leaving the view ends it.
- hal is a one-ply material-greedy player: it never plans, so it is a beginner's opponent.
- Sounds can only start after a user gesture (browser autoplay policy); an opponent's move that
  arrives before any interaction on the page is silent.
- The e2e test covers the offline path and every screen reachable without a server; matchmaking,
  invites, chat, voice and replays need a running platform and are verified by `rules.mjs` at the
  script level only.
- The cover tile bakes an English title into the image.

## Design intent not yet implemented

- Localization into the nine target locales with a `navigator.languages` default and a persisted
  override; strings would move out of the markup and literals into a table.
- An `aria-live` announcement of each move ("hal plays Nf3", "Check") and of game end.
- Pausing the starfield under `prefers-reduced-motion`, and a per-user toggle for it.
- A short "How to play" note on the landing card for players new to chess itself.
