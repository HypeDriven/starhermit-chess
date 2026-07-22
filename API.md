# Chess ↔ Starhermit API contract

The chess game runs on the starhermit platform's **Games** subsystem (added for
this game, but generic). Starhermit hosts `server.js` in a sandboxed JS engine;
every client command is validated by that script before anything is relayed to
the other player. The platform also provides auth, matchmaking, invites, chat,
voice, the elo leaderboard, and replays.

All requests are **same-origin**: launched from the Starhermit client the game
is served by the platform, so REST goes to `/api/v1/...` and WebSockets to
`/ws/v1/...` directly. REST calls send `Authorization: Bearer <token>`;
WebSockets authenticate with `?access_token=<token>` in the query string.

**Game slug.** Every game has a URL-safe slug on the platform. This game declares
`slug=chess` in its `starhermit.txt`, so its endpoints live under
`/api/v1/games/chess/...` and the examples below use `chess`. A game built from
this template substitutes its own slug — the client never hard-codes it, it
reads the slug from the launch token's `game_scope` claim.

## Publishing the game (how it gets onto the platform)

There is no separate deploy step and no internal tooling. A player adds the game
through the Starhermit client — **Add game → paste the GitHub repo URL** — and
the platform reads `starhermit.txt` at the repo root to:

- identify the **owner** (`owner=`, a Starhermit username or user id) and verify
  it against the submitter;
- read the optional **server script** (`server=`, a repo-relative `.js`/`.mjs`
  file). Games that need multiplayer or server-side logic name it here; the
  platform fetches that file and runs it as the game's authoritative server
  script in its sandboxed engine. Games with no server logic omit the line and
  are pure browser games.

Resource budgets (state per player, CPU/memory/statements per script call,
concurrent sessions) are applied by the platform with sensible defaults; they
are not something a game repo configures.

## Launch flow & the game-scoped token

The platform launcher (or any frontend holding a full user JWT) calls:

```
POST /api/v1/games/chess/launch-token          (full user JWT required)
→ 200 { "token": "<jwt>", "expiresInSeconds": 3600 }
```

and opens the game as `index.html#game_token=<jwt>`. An optional
`&session_id=<guid>` in the same fragment makes the client jump straight into
that session after signing in — dashboards use this to implement
"accept invite and join". The returned token is a
**game-scoped** token: it is a signed JWT carrying the player (`sub`) and the
game (`game_scope: chess`), both verified server-side on every request
(signature + token-revocation version), so it cannot be forged or its scope
re-pointed without invalidating the signature. The API rejects any request made
with it outside the chess surface (the `/api/v1/games/chess/*` endpoints, the
games WebSocket **for chess sessions only**, the chess elo leaderboard read,
the friends list read, avatar/profile reads, and the chat/voice endpoints *only
for conversations attached to chess sessions*). It expires after 1 hour; the
client may refresh it while it is still valid via the same endpoint (a
game-scoped token is allowed to call `launch-token` for its own game only).

Isolation guarantees this enforces, so one game can never touch another's
state even if a client hands its token to a different game:
- The game WebSocket binds the session to the token's `game_scope`: a chess
  token cannot attach to the same user's session in another game.
- A game's elo leaderboard is written **only** by the platform from the script's
  reported results; direct `POST /leaderboards/{id}/submit` to a game
  leaderboard is refused for every caller, so no player can assign their own
  rating.
- Each game's server script executes in its own sandbox and is only ever handed
  its own game's stored rows — one game's backend logic physically cannot read
  or modify another game's session or player state.

If `index.html` is opened without `#game_token` (local development), the client
shows a panel where a user JWT and the game slug can be entered; it then calls
`launch-token` itself and proceeds identically.

## Game info & rating

```
GET /api/v1/games/chess
→ 200 {
  "slug": "chess", "name": "Chess", "enabled": true,
  "leaderboardId": "<guid>",           // elo leaderboard
  "maxConcurrentSessionsPerPlayer": 20,
  "me": { "userId": "<guid>", "elo": 1200, "wins": 0, "losses": 0, "draws": 0,
          "activeSessionCount": 3 }
}
```

`me.elo` etc. come from the script-owned per-player state; `elo` is 1200 for
players who have never finished a game.

## Sessions (create / rejoin / list)

```
GET  /api/v1/games/chess/sessions/mine
→ 200 [ { "sessionId", "status": "active"|"finished",
          "players": [{ "userId", "username" }],
          "createdAt", "finishedAt": null,
          "myTurn": true|false|null,     // from session state, null if finished
          "deadline": <ms epoch>|null }, ... ]     // move timeout deadline

GET  /api/v1/games/chess/sessions/{sessionId}
→ 200 { "sessionId", "status", "players": [...], "createdAt", "finishedAt",
        "chatConversationId": "<guid>",       // per-session chat
        "result": { "kind": "white"|"black"|"draw", "reason": "..." } | null }
```

Sessions are only created by matchmaking, invite acceptance (below), or the
practice endpoint — there is no "create empty session and wait" endpoint. A
player may have at most **20 active sessions**; matchmaking/invites fail with
`409` beyond that.

### Practice session (AI opponent)

```
POST /api/v1/games/chess/sessions/ai   → 200 { "sessionId" }   (409 at the cap)
```

Creates a session between the caller and the platform's AI seat, displayed by
this game as **hal**. The platform flags that player with `ai: true` in the
script's `createSession`, and `server.js` plays the seat itself: a greedy
material-count algorithm that answers within the same invocation as the
human's move (and opens immediately when it draws white). Games against hal are
rated normally: both the human and hal have persistent Elo and win/loss/draw
records. The state view carries `ai: "white"|"black"` and `aiName: "hal"` so
clients can adapt (the chess client offers this after 30 s of unmatched
matchmaking).

## Matchmaking (elo-based)

```
POST   /api/v1/games/chess/matchmaking      → 200 { "ticketId", "status": "queued" }
                                            | 200 { "ticketId", "status": "matched", "sessionId" }
GET    /api/v1/games/chess/matchmaking      → 200 { "ticketId", "status", "sessionId"? } | 404 (no ticket)
DELETE /api/v1/games/chess/matchmaking      → 204 (cancels my queued ticket)
```

Enqueuing when a compatible opponent is queued matches immediately (nearest
elo). Otherwise the ticket waits; the client polls GET every few seconds. A
match creates the session (the script assigns colors: random for a first
pairing, alternating for rematches) and both players see it in
`sessions/mine`. You cannot be matched against yourself and duplicate queue
entries are rejected (`409`).

## Invitations ("join me in this game")

```
POST /api/v1/games/chess/invites            { "toUserId": "<friend guid>" }
→ 200 { "inviteId", "status": "pending" }        (409 if either side is at cap)
GET  /api/v1/games/chess/invites            → 200 { "incoming": [ { "inviteId", "from": {"userId","username"}, "createdAt" } ],
                                                    "outgoing": [ { "inviteId", "to": {...}, "status", "createdAt" } ] }
POST /api/v1/games/chess/invites/{id}/accept  → 200 { "sessionId" }
POST /api/v1/games/chess/invites/{id}/decline → 204
```

Invites can only be sent to friends (`GET /api/v1/me/friends` for the picker).
Accepting creates the session immediately.

For opponents who are not friends (or not on the platform) yet, the menu's
**Share invite link** button copies a web-dashboard share URL:

```
https://dashboard.starhermit.com/game-invite/<my userId>/<slug>
```

Opening it signs the recipient in, friends them with the sharer (with a
nickname prompt for new accounts), launches the game, and sends the play
invite back to the sharer — so it arrives through the normal invites list
above. The client only builds the string (`App.shareInviteLink`); the
dashboard does the rest.

For display the client never shows a raw username: it resolves each friend /
inviter through the platform's public profile endpoints (both allowed for
game-scoped tokens):

```
GET /api/v1/users/{id}/profile   → 200 { "id", "username", "nickname" }
GET /api/v1/users/{id}/avatar    → 200 image/png | 404 (no picture set)
```

and renders the profile nickname plus avatar (an initial-letter placeholder
when no picture is set). Player-facing game and replay views never render the
account username; if profile lookup fails they use a neutral shortened id.

## Replays

```
GET /api/v1/games/chess/replays/mine?limit=10
→ 200 [ { "sessionId", "players": [{userId,username}], "finishedAt", "moveCount",
          "result": { "kind", "reason", "at", "white", "black", "moveCount",
                      "eloBefore": { "<userId>": 1200, ... },
                      "eloAfter":  { "<userId>": 1216, ... } } }, ... ]

GET /api/v1/games/chess/replays/{sessionId}
→ 200 { "sessionId", "players": [{userId,username}], "finishedAt",
        "result": { ...same as above... },
        "state": <archived session state> }

`state` is the script-owned session document archived at game end; for chess it
contains `white`, `black`, and `game.moves`
(`[ { "from":"e2","to":"e4","promo":null,"san":"e4","at":<ms> } ]`).
```

Only participants of the session can fetch a replay.

## Leaderboard (friends top-10 elo)

Standard starhermit leaderboard, id from `GET /games/chess` → `leaderboardId`:

```
GET /api/v1/leaderboards/{leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10
→ 200 { "entries": [ { "userId", "username", "score": 1216, "rank": 1 } ], ... }
```

The platform (not the client) submits elo to this leaderboard whenever the
script reports a game result; one entry per player (latest elo).

## The game WebSocket (command relay)

```
ws://<host>/ws/v1/games?sessionId=<id>&access_token=<game token>
```

Only session participants can connect. Text frames are JSON.

**Client → server:** `{ "type": "cmd", "data": <command> }` where `<command>`
is one of the chess commands below. The platform passes `data` to
`server.js → game.onPlayerMessage` with the authenticated sender id — the
client's identity is never taken from the payload.

**Server → client:**
- `{ "type": "game", "data": <broadcast> }` — a message the script validated
  and addressed to you (most carry the full session `view`, see below).
- `{ "type": "error", "error": "<why>" }` — your last command was rejected.
- `{ "type": "presence", "userId": "...", "online": true|false }` — the other
  player's socket came/went.

### Chess commands (client → script)

| command | shape |
|---|---|
| sync | `{ "type": "sync" }` → script replies (to you only) with a `state` view |
| move | `{ "type": "move", "from": "e2", "to": "e4", "promo": "q"\|"r"\|"b"\|"n"? }` |
| resign | `{ "type": "resign" }` |
| offer draw | `{ "type": "offer-draw" }` |
| accept draw | `{ "type": "accept-draw" }` |
| decline draw | `{ "type": "decline-draw" }` |

### Script broadcasts (script → clients)

- `{ "type": "state", white, black, ratings: {white,black}, board, turn, moves, status, result, deadline, drawOfferBy }`
  — full session view. `ratings` contains each seat's Elo, including hal's
  persistent rating in AI games. `board` is a 64-char string, index = rank*8+file,
  `"a1"` = index 0, chars `PNBRQK` white / `pnbrqk` black / `.` empty.
  `deadline` is the ms-epoch time at which the player to move loses on time
  (24 h per move; if the game times out before anyone has moved it is a draw).
- `{ "type": "moved", by: "white"|"black", san, from, to, promo, view: <state> }`
- `{ "type": "draw-offered"|"draw-declined", by }`
- `{ "type": "game-over", result: { kind, reason, at }, view: <state> }`
  — reasons: checkmate, stalemate, threefold-repetition, fifty-move-rule,
  insufficient-material, resignation, agreement, timeout, timeout-no-moves.

## Per-session chat

Each session has a dedicated starhermit chat conversation
(`chatConversationId` from the session endpoint) whose two participants are
the players — works between non-friends. Standard chat API:

```
GET  /api/v1/chat/conversations/{id}/messages?page=1&pageSize=50
POST /api/v1/chat/conversations/{id}/messages     { "content": "gg" }
```

Note: the chat push socket (`ws /ws/v1/chat`) streams events for **all** of the
user's conversations, so it is blocked for game-scoped tokens; the game client
polls the messages endpoint instead (~5 s).

## Voice chat (opt-in, default off)

Voice is **off by default for every new game**. When a player enables it the
client (all standard starhermit voice endpoints, allowed for the session's
conversation under a game token):

1. `POST /api/v1/voice/rooms { "conversationId": <chatConversationId> }`
   (or `GET /api/v1/voice/rooms?conversationId=` to find an existing one),
2. `POST /api/v1/voice/rooms/{roomId}/join`,
3. connects `ws://<host>/ws/v1/voice?roomId=<id>&access_token=<token>` and uses
   the `{"type":"rtc","to":<userId>,"payload":<sdp/ice>}` control messages for
   WebRTC signaling (server-relayed opus frames are the non-WebRTC fallback).
   Server events: `voice.roster`, `voice.participant_joined/left`,
   `voice.mute_changed`, `voice.speaking`, `voice.rtc`.

The other player sees the room exist (poll `GET /voice/rooms?conversationId=`)
and may join or ignore it — voice never auto-joins.

## Resource budgets (platform-enforced)

The platform sandboxes `server.js` and applies per-game resource limits with
defaults so a game repo never has to configure them:

- per-player script state budget (**5 MB**) — the script's per-player doc
  (elo, history, pairing colors) and the per-session doc must each serialize
  under this budget or the update is rejected;
- CPU time per script invocation (**250 ms**), memory per invocation
  (**32 MB**), and a max-JS-statements ceiling — enforced by the sandbox;
- max concurrent sessions per player (**20**).

The platform meters each invocation's processing time so operators can tune
these limits for abusive or runaway scripts. That tuning is a platform-side
concern; a game repo neither calls it nor depends on it.
