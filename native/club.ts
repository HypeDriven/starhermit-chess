// The club: practice for everyone; for a signed-in player matchmaking, My
// games, invitations, friends' ratings and recent games.
import { clipboard, frame } from "starhermit:engine";
import * as ui from "starhermit:ui";
import {
  achievements, friends, gameInfo, inviteLink, leaderboards, matchmaking, player, replays, requestSignIn, sessions,
  type Achievement, type Friend, type GameStats, type LeaderboardEntry, type ReplaySummary, type Session, type SessionInvite,
} from "starhermit:platform";
import { storage } from "starhermit:storage";
import { PALETTE } from "./board.js";
import { achievementText, fmtLeft, reasonText, T } from "./i18n.js";
import { sfx } from "./sfx.js";
import { hasKeptPractice } from "./table.js";
import { errorText, loadName, nameOf, nav, scrollPanel, short, toast, type Screen } from "./shell.js";
import { cardButton, drawKeyArt, framedPanel, frameRect, note, panelTitle, pill, primaryButton, smallButton, TOP_BAR, topBar } from "./style.js";

const HOUR_MS = 60 * 60 * 1000;
const HAL_AFTER_S = 30;
// translated:
const HOW_TO = [
  "Checkmate the other king: attack it so that it has no way out.",
  "Pick one of your pieces to see where it can go, then pick one of its dots. Only legal moves are shown.",
  "Special moves: castling (the king steps two squares toward a rook, which jumps over it), en passant, and promotion when a pawn reaches the far side.",
  "A game is drawn by stalemate, threefold repetition, the fifty-move rule, too little material to mate, or agreement.",
  "Club games are correspondence chess: one move a day, 24 hours per move, rated with Elo. Practice against hal any time — no clock, no rating.",
];

export class ClubScreen implements Screen {
  private me: GameStats | null = null;
  private replaysEnabled = true;
  private games: Session[] = [];
  private incoming: SessionInvite[] = [];
  private outgoing: SessionInvite[] = [];
  private friendRatings: LeaderboardEntry[] = [];
  private recent: ReplaySummary[] = [];
  private link: string | null = null;
  private searchingSince: number | null = null;
  private friendPicker: Friend[] | null = null;
  private timers: number[] = [];
  private busy = false;
  private howTo = false;
  private achievements: Achievement[] = [];

  constructor() {
    if (!player()) return;
    this.refresh();
    this.refreshInvites();
    this.resumeSearch();
    this.timers.push(setInterval(() => this.refreshGames(), 30_000));
    this.timers.push(setInterval(() => this.refreshInvites(), 10_000));
  }

  dispose(): void {
    for (const t of this.timers) clearInterval(t);
  }

  private storageKey(): string { return `matchmaking.${player()?.userId ?? "guest"}`; }

  private refresh(): void {
    gameInfo().then(async (info) => {
      this.me = info.me;
      this.replaysEnabled = info.replaysEnabled;
      if (info.replaysEnabled) replays.list({ limit: 10 }).then((r) => { this.recent = r; }, () => { /* none shown */ });
      achievements.list().then((a) => { this.achievements = a; }, () => { /* none shown */ });
      if (info.leaderboardId) {
        leaderboards.entries(info.leaderboardId, { friendsOnly: true, pageSize: 10 })
          .then((p) => { this.friendRatings = p.items; }, () => { /* none shown */ });
      }
    }, (e) => toast(errorText(e), true));
    this.refreshGames();
    // Fetched ahead: the clipboard takes text only during the press itself.
    inviteLink().then((l) => { this.link = l; }, () => { /* no share button */ });
  }

  private refreshGames(): void {
    sessions.list().then((list) => {
      for (const s of list) for (const p of s.players) loadName(p.userId);
      this.games = list.filter((s) => s.status === "active").sort((a, b) =>
        Number(b.myTurn) - Number(a.myTurn) || (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
    }, () => { /* keep the last list */ });
  }

  private refreshInvites(): void {
    sessions.invites().then((r) => {
      this.incoming = r.incoming.filter((i) => i.status === "pending" || !i.status);
      this.outgoing = r.outgoing.filter((i) => i.status === "pending");
    }, () => { /* keep the last list */ });
  }

  // -- Matchmaking -------------------------------------------------------------------
  private async resumeSearch(): Promise<void> {
    const saved = storage.getJson(this.storageKey()) as { startedAt?: number } | null;
    if (!saved) return;
    try {
      const t = await matchmaking.ticket();
      if (t && t.status === "queued") { this.searchingSince = saved.startedAt ?? Date.now(); this.poll(); }
      else storage.remove(this.storageKey());
    } catch { storage.remove(this.storageKey()); }
  }

  private async startSearch(): Promise<void> {
    try {
      const queues = await matchmaking.queues().catch(() => []);
      const t = await matchmaking.enqueue(queues.map((q) => q.key));
      if (t.status === "matched" && t.sessionId) { sfx("matchFound"); nav.table(t.sessionId); return; }
      this.searchingSince = Date.now();
      storage.setJson(this.storageKey(), { startedAt: this.searchingSince });
      this.poll();
    } catch (e) {
      toast(T("Cannot queue: {error}", { error: errorText(e) }), true);
    }
  }

  private poll(): void {
    const tick = async () => {
      if (this.searchingSince == null) return;
      try {
        const t = await matchmaking.ticket();
        if (this.searchingSince == null) return;
        if (t?.status === "matched" && t.sessionId) {
          this.stopSearch(false);
          sfx("matchFound");
          nav.table(t.sessionId);
          return;
        }
        if (!t || t.status !== "queued") { this.stopSearch(false); return; }
      } catch { /* try again */ }
      this.timers.push(setTimeout(tick, 3000));
    };
    this.timers.push(setTimeout(tick, 3000));
  }

  private stopSearch(cancel: boolean): void {
    this.searchingSince = null;
    storage.remove(this.storageKey());
    if (cancel) matchmaking.cancel().catch(() => { /* already gone */ });
  }

  private async playHal(): Promise<void> {
    this.stopSearch(true);
    try { nav.table(await sessions.practice()); }
    catch (e) { toast(errorText(e), true); }
  }

  // -- Frame ---------------------------------------------------------------------------
  // The browser client's club room: a top bar, then a centred page (at most
  // 1116 logical pixels) of framed panels — main column and a 320-pixel side
  // column, stacked on a narrow window. Behind it the starfield (main.ts) or,
  // signed out, the key art.
  update(): void {
    const { width, height, scale, safeArea } = frame();
    const p = player();
    if (!p) drawKeyArt();
    topBar(p ? this.me?.elo ?? null : null);
    const top = safeArea.top + (TOP_BAR + 22) * scale;
    const avail = (width - safeArea.left - safeArea.right) / scale - 44;
    const cw = Math.min(1116, avail);
    const x0 = safeArea.left + ((width - safeArea.left - safeArea.right) / scale - cw) / 2 * scale;
    const h = height - top - safeArea.bottom - 8 * scale;
    if (!p) {
      const w = Math.min(460, cw);
      scrollPanel("club-guest", { x: x0 + (cw - w) / 2 * scale, y: top + Math.min(60, height / scale * 0.06) * scale, width: (w + 12) * scale, height: h }, () => this.guest(w));
      this.howToDialog();
      return;
    }
    const wide = cw >= 760;
    const mainW = wide ? cw - 320 - 22 : cw;
    scrollPanel("club-main", { x: x0, y: top, width: (mainW + 12) * scale, height: h }, () => {
      ui.column("club", () => {
        this.playPanel(mainW);
        this.myGames(mainW);
        this.invitations(mainW);
        if (!wide) this.sidePanel(mainW);
      }, { spacing: 18 });
    });
    if (wide) {
      const side = { x: x0 + (mainW + 22) * scale, y: top, width: (320 + 12) * scale, height: h };
      scrollPanel("club-side-scroll", side, () => ui.column("club-side", () => this.sidePanel(320), { spacing: 18 }));
    }
    this.friendDialog();
    this.howToDialog();
  }

  /** The rules in five lines, for players new to chess. */
  private howToDialog(): void {
    if (!this.howTo) return;
    const { width, height, scale } = frame();
    const w = Math.min(460, width / scale - 64);
    const open = ui.dialog("how-to-play", T("How to play"), true, () => {
      ui.scrollArea("how-to-scroll", { width: w, height: Math.min(470, height / scale - 200) }, () => {
        ui.column("how-to-text", () => {
          for (const line of HOW_TO) ui.paragraph(T(line), w - 16);
        }, { spacing: 10 });
      });
      if (ui.id("how-to-ok").button(T("Got it"))) this.howTo = false;
    });
    if (!open) this.howTo = false;
  }

  /** Signed out: the "Take a seat" card over the key art. */
  private guest(w: number): void {
    framedPanel("landing", w, () => {
      ui.label(T("Take a seat"), { font: "serif", size: 28, weight: "600" });
      ui.paragraph(T("Practice against hal right now — no sign-in needed."), w - 32, { size: 14 });
      ui.row("landing-play", () => {
        if (primaryButton("play-local", T("Play"), { big: true })) nav.practice(false);
        if (hasKeptPractice() && ui.id("resume-practice").button(T("Resume practice"))) nav.practice(true);
        if (smallButton("how-to", T("How to play"))) this.howTo = true;
      }, { spacing: 10, align: "center" });
      ui.label(T("or sign in to the club").toUpperCase(), { size: 11, color: PALETTE.faint });
      if (ui.id("sign-in").button(T("Sign in with StarHermit"), { size: 15 })) {
        requestSignIn().then((pl) => { if (pl) nav.club(); }, (e) => toast(errorText(e), true));
      }
    }, 16);
  }

  private playPanel(w: number): void {
    ui.column("play", () => {
      if (this.searchingSince == null) {
        ui.row("play-row", () => {
          if (primaryButton("play-online", T("Play"), { big: true, disabled: this.busy })) {
            this.busy = true;
            this.startSearch().finally(() => { this.busy = false; });
          }
          if (w >= 560) note(T("Matched by rating against another club member"));
          if (ui.id("practice").button(T("Practice vs hal"))) nav.practice(false);
        }, { spacing: 14, align: "center" });
      } else {
        ui.row("search-row", () => {
          ui.label(T("Looking for an opponent…"), { font: "serif", color: PALETTE.muted });
          if (ui.id("cancel-search").button(T("Cancel"))) this.stopSearch(true);
          const waited = (Date.now() - this.searchingSince!) / 1000;
          if (waited >= HAL_AFTER_S && primaryButton("play-hal", T("Play against hal"))) this.playHal();
        }, { spacing: 14, align: "center" });
      }
      ui.row("play-row-2", () => {
        if (hasKeptPractice() && smallButton("resume-practice", T("Resume practice"))) nav.practice(true);
        if (smallButton("how-to", T("How to play"))) this.howTo = true;
      }, { spacing: 8 });
    }, { spacing: 10, width: w });
  }

  /** A panel's header: the title, and a note or buttons after it. */
  private header(id: string, title: string, inner: number, after?: () => void): void {
    ui.row(id, () => {
      panelTitle(title);
      if (after) after();
    }, { spacing: 12, align: "center", width: inner });
  }

  /** A card: a raised row inside a panel (the browser client's .card). */
  private card(id: string, inner: number, build: () => void): void {
    const r = ui.row(id, build, { spacing: 12, align: "center", width: inner, background: PALETTE.panel2, padding: { top: 8, bottom: 8, start: 12, end: 12 } });
    frameRect(r);
  }

  private myGames(w: number): void {
    const inner = w - 32;
    framedPanel("my-games", w, () => {
      this.header("games-head", T("My games"), inner, () => note(T("{n} of {cap} seats", { n: this.games.length, cap: 20 })));
      if (!this.games.length) ui.label(T("No games in progress."), { font: "serif", color: PALETTE.faint });
      const narrow = w < 520;
      for (const g of this.games) {
        const opp = g.players.find((x) => x.userId !== player()?.userId);
        const left = g.deadline ? g.deadline - Date.now() : null;
        const urgent = left != null && left < HOUR_MS && g.myTurn;
        this.card(`game-card-${g.sessionId}`, inner, () => {
          if (cardButton(`game-${g.sessionId}`, short(opp ? nameOf(opp.userId) : "hal"))) nav.table(g.sessionId);
          if (left != null && !narrow) ui.label(T("{time} left", { time: fmtLeft(left) }), { size: 13, color: urgent ? PALETTE.danger : PALETTE.muted });
          pill(`pill-${g.sessionId}`, g.myTurn ? T("your move") : T("their move"), g.myTurn);
        });
      }
    });
  }

  private invitations(w: number): void {
    const inner = w - 32;
    framedPanel("invites", w, () => {
      this.header("invites-head", T("Invitations"), inner, () => {
        if (this.link && smallButton("share-link", T("Share invite link"))) {
          try { clipboard.writeText(this.link); toast(T("Invite link copied.")); }
          catch { toast(this.link); }
        }
        if (smallButton("invite-friend", T("Invite a friend"))) {
          friends.list().then((f) => { this.friendPicker = f; }, (e) => toast(T("Could not load friends: {error}", { error: errorText(e) }), true));
        }
      });
      for (const inv of this.incoming) {
        this.card(`inv-${inv.inviteId}`, inner, () => {
          ui.label(short(nameOf(inv.from)), { font: "serif", size: 16 });
          ui.label(T("invites you to a game"), { size: 13, color: PALETTE.muted });
          if (primaryButton(`acc-${inv.inviteId}`, T("Accept"))) {
            sessions.acceptInvite(inv.inviteId).then((sid) => nav.table(sid), (e) => toast(errorText(e), true));
          }
          if (smallButton(`dec-${inv.inviteId}`, T("Decline"))) {
            sessions.declineInvite(inv.inviteId).then(() => this.refreshInvites(), (e) => toast(errorText(e), true));
          }
        });
      }
      for (const inv of this.outgoing) {
        this.card(`out-${inv.inviteId}`, inner, () => {
          ui.label(short(nameOf(inv.to)), { font: "serif", size: 16 });
          ui.label(T("invited — waiting"), { size: 13, color: PALETTE.muted });
        });
      }
    });
  }

  private sidePanel(w: number): void {
    const inner = w - 32;
    framedPanel("rating", w, () => {
      panelTitle(T("My rating"));
      const m = this.me;
      ui.label(m?.elo != null ? String(m.elo) : "—", { font: "serif", size: 34, color: PALETTE.brass });
      ui.label(T("{wins} won · {losses} lost · {draws} drawn", { wins: m?.wins ?? 0, losses: m?.losses ?? 0, draws: m?.draws ?? 0 }), { font: "serif", size: 14, color: PALETTE.muted });
    }, 4);
    // Locked secret achievements stay hidden, as the platform keeps them.
    const shown = this.achievements.filter((a) => a.unlocked || !a.secret);
    if (shown.length) {
      framedPanel("achievements", w, () => {
        const n = this.achievements.filter((a) => a.unlocked).length;
        this.header("ach-head", T("Achievements"), inner, () => note(T("{n} of {total} unlocked", { n, total: this.achievements.length })));
        for (const a of shown) {
          const t = achievementText(a);
          ui.row(`ach-${a.key}`, () => {
            ui.label(a.unlocked ? "✓" : "○", { color: a.unlocked ? PALETTE.brass : PALETTE.faint });
            ui.column(`ach-text-${a.key}`, () => {
              ui.label(t.name, { font: "serif", size: 15, color: a.unlocked ? PALETTE.ink : PALETTE.muted });
              ui.paragraph(t.description, inner - 28, { size: 12.5 });
            }, { spacing: 1 });
          }, { spacing: 8 });
        }
      }, 8);
    }
    if (this.friendRatings.length) {
      framedPanel("friends", w, () => {
        panelTitle(T("Friends table"));
        for (const e of this.friendRatings) {
          const me = e.userId === player()?.userId;
          ui.row(`lb-${e.userId}`, () => {
            ui.column(`lb-rank-${e.userId}`, () => ui.label(String(e.rank), { size: 14, color: PALETTE.faint }), { width: 30 });
            ui.column(`lb-name-${e.userId}`, () => ui.label(short(nameOf(e.userId), 22), { size: 14, color: me ? PALETTE.brassHi : PALETTE.ink }), { width: inner - 100 });
            ui.column(`lb-score-${e.userId}`, () => ui.label(String(e.score), { font: "serif", size: 14, color: PALETTE.brass }), { width: 60, align: "end" });
          }, { spacing: 4, width: inner });
        }
      }, 6);
    }
    if (this.replaysEnabled) {
      framedPanel("recent", w, () => {
        panelTitle(T("Recent games"));
        if (!this.recent.length) ui.label(T("No finished games yet."), { font: "serif", color: PALETTE.faint });
        const narrow = frame().width / frame().scale < 560;
        const me = player()?.userId ?? "";
        for (const r of this.recent) {
          const opp = r.players.find((x) => x.userId !== me);
          const res = r.result as { kind?: string; reason?: string; white?: string; eloBefore?: Record<string, number>; eloAfter?: Record<string, number> } | null;
          const myColor = res?.white === me ? "white" : "black";
          const outcome = !res?.kind ? "" : res.kind === "draw" ? T("Drawn")
            : res.kind === "white" || res.kind === "black" ? (res.kind === myColor ? T("Won") : T("Lost")) : T("Abandoned");
          const delta = res?.eloBefore?.[me] != null && res.eloAfter?.[me] != null ? res.eloAfter[me]! - res.eloBefore[me]! : null;
          this.card(`recent-${r.sessionId}`, inner, () => {
            if (cardButton(`replay-${r.sessionId}`, short(opp ? nameOf(opp.userId) : "hal", 14))) nav.replay(r.sessionId);
            // A narrow window leaves the reason to the replay itself.
            ui.label([outcome, narrow ? "" : reasonText(res?.reason)].filter(Boolean).join(" · "), { size: 12.5, color: PALETTE.muted });
            if (delta) ui.label(`${delta > 0 ? "+" : ""}${delta}`, { size: 12.5, color: delta > 0 ? PALETTE.ok : PALETTE.danger });
          });
        }
      }, 8);
    }
  }

  private friendDialog(): void {
    if (!this.friendPicker) return;
    const list = this.friendPicker;
    // The list scrolls inside a fixed width so long names and long lists fit
    // the window (the dialog does not grow to its widest button).
    const { height, scale } = frame();
    const listH = Math.min(list.length * 37, height / scale - 220);
    const open = ui.dialog("friend-picker", T("Invite a friend"), true, () => {
      if (!list.length) ui.label(T("No friends yet."), { tone: "muted" });
      else ui.scrollArea("friend-scroll", { width: 320, height: Math.max(listH, 80) }, () => {
        ui.column("friend-list", () => {
          for (const f of list) {
            if (ui.id(`friend-${f.userId}`).button(`${f.online ? "● " : "○ "}${short(nameOf(f.userId), 24)}`)) {
              this.friendPicker = null;
              sessions.invite(f.userId).then(() => { toast(T("Invitation sent.")); this.refreshInvites(); },
                (e) => toast(T("Could not invite: {error}", { error: errorText(e) }), true));
            }
          }
        }, { spacing: 6 });
      });
      if (ui.id("friend-cancel").button(T("Cancel"))) this.friendPicker = null;
    });
    if (!open) this.friendPicker = null;
  }
}
