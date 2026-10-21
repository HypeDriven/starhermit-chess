// The club: practice for everyone; for a signed-in player matchmaking, My
// games, invitations, friends' ratings and recent games.
import { clipboard, frame } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import {
  friends, gameInfo, inviteLink, leaderboards, matchmaking, player, replays, requestSignIn, sessions,
  type Friend, type GameStats, type LeaderboardEntry, type ReplaySummary, type Session, type SessionInvite,
} from "starhermit:platform";
import { storage } from "starhermit:storage";
import { PALETTE } from "./board.js";
import { fmtLeft, reasonText, T } from "./i18n.js";
import { sfx } from "./sfx.js";
import { errorText, nameOf, nav, rememberName, toast, type Screen } from "./shell.js";

const HOUR_MS = 60 * 60 * 1000;
const HAL_AFTER_S = 30;

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
      for (const s of list) for (const p of s.players) rememberName(p.userId, p.username);
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
  update(): void {
    const { width, height, scale, safeArea } = frame();
    const area = {
      x: safeArea.left + 16 * scale, y: safeArea.top + 16 * scale,
      width: width - safeArea.left - safeArea.right - 32 * scale,
      height: height - safeArea.top - safeArea.bottom - 32 * scale,
    };
    draw.text("Chess", area.x, area.y, { size: 34 * scale, color: PALETTE.brassHi, font: "serif" });
    const p = player();
    const top = { ...area, y: area.y + 56 * scale, height: area.height - 56 * scale };
    if (!p) { ui.area(top, () => this.guest()); return; }

    const wide = top.width > 900 * scale;
    const mainW = wide ? top.width * 0.58 : top.width;
    ui.area({ ...top, width: mainW }, () => {
      ui.scrollArea("club-main", { width: mainW / scale - 8, height: top.height / scale - 8 }, () => {
        ui.column("club", () => {
          this.playPanel();
          this.myGames();
          this.invitations();
          if (!wide) this.sidePanel();
        }, { spacing: 16 });
      });
    });
    if (wide) {
      const side = { x: top.x + mainW + 24 * scale, y: top.y, width: top.width - mainW - 24 * scale, height: top.height };
      ui.area(side, () => ui.column("club-side", () => this.sidePanel(), { spacing: 16 }));
    }
    this.friendDialog();
  }

  private guest(): void {
    ui.column("landing", () => {
      ui.heading(T("Take a seat"));
      ui.paragraph(T("Practice against hal right now — no sign-in needed."), 420);
      if (ui.id("play-local").button(T("Play"))) nav.table(null);
      ui.label(T("or sign in to the club"), { tone: "muted" });
      if (ui.id("sign-in").button(T("Sign in with StarHermit"))) {
        requestSignIn().then((pl) => { if (pl) nav.club(); }, (e) => toast(errorText(e), true));
      }
    }, { spacing: 12 });
  }

  private playPanel(): void {
    ui.panel("play", () => {
      ui.heading(T("Play"));
      if (this.searchingSince == null) {
        ui.row("play-row", () => {
          if (ui.id("play-online").button(T("Play"), { disabled: this.busy })) {
            this.busy = true;
            this.startSearch().finally(() => { this.busy = false; });
          }
          if (ui.id("practice").button(T("Practice vs hal"))) nav.table(null);
        }, { spacing: 8 });
      } else {
        ui.label(T("Looking for an opponent…"), { tone: "accent" });
        const waited = (Date.now() - this.searchingSince) / 1000;
        ui.row("search-row", () => {
          if (ui.id("cancel-search").button(T("Cancel"))) this.stopSearch(true);
          if (waited >= HAL_AFTER_S && ui.id("play-hal").button(T("Play against hal"))) this.playHal();
        }, { spacing: 8 });
      }
    }, { padding: 14, spacing: 10 });
  }

  private myGames(): void {
    ui.panel("my-games", () => {
      ui.heading(T("My games"));
      if (!this.games.length) ui.label(T("No games in progress."), { tone: "muted" });
      for (const g of this.games) {
        const opp = g.players.find((x) => x.userId !== player()?.userId);
        const name = opp ? nameOf(opp.userId, opp.username) : "hal";
        const left = g.deadline ? g.deadline - Date.now() : null;
        const turn = g.myTurn ? T("your move") : T("their move");
        const time = left == null ? "" : ` — ${T("{time} left", { time: fmtLeft(left) })}`;
        if (ui.id(`game-${g.sessionId}`).button(`${name} · ${turn}${time}`, { tone: left != null && left < HOUR_MS && g.myTurn ? "danger" : "normal" })) {
          nav.table(g.sessionId);
        }
      }
    }, { padding: 14, spacing: 8 });
  }

  private invitations(): void {
    ui.panel("invites", () => {
      ui.heading(T("Invitations"));
      for (const inv of this.incoming) {
        ui.row(`inv-${inv.inviteId}`, () => {
          ui.label(T("{name} invites you to a game", { name: nameOf(inv.from) }));
          if (ui.id(`acc-${inv.inviteId}`).button(T("Accept"))) {
            sessions.acceptInvite(inv.inviteId).then((sid) => nav.table(sid), (e) => toast(errorText(e), true));
          }
          if (ui.id(`dec-${inv.inviteId}`).button(T("Decline"))) {
            sessions.declineInvite(inv.inviteId).then(() => this.refreshInvites(), (e) => toast(errorText(e), true));
          }
        }, { spacing: 8, align: "center" });
      }
      for (const inv of this.outgoing) ui.label(`${nameOf(inv.to)} — ${T("invited — waiting")}`, { tone: "muted" });
      ui.row("invite-row", () => {
        if (ui.id("invite-friend").button(T("Invite a friend"))) {
          friends.list().then((f) => { this.friendPicker = f; }, (e) => toast(T("Could not load friends: {error}", { error: errorText(e) }), true));
        }
        if (this.link && ui.id("share-link").button(T("Share invite link"))) {
          try { clipboard.writeText(this.link); toast(T("Invite link copied.")); }
          catch { toast(this.link); }
        }
      }, { spacing: 8 });
    }, { padding: 14, spacing: 8 });
  }

  private sidePanel(): void {
    ui.panel("rating", () => {
      ui.heading(T("My rating"));
      const m = this.me;
      ui.label(m?.elo != null ? `Elo ${m.elo}` : "Elo —", { tone: "accent" });
      ui.label(`${T("W")} ${m?.wins ?? 0} · ${T("L")} ${m?.losses ?? 0} · ${T("D")} ${m?.draws ?? 0}`, { tone: "muted" });
    }, { padding: 14, spacing: 6 });
    if (this.friendRatings.length) {
      ui.panel("friends", () => {
        ui.heading(T("Friends"));
        for (const e of this.friendRatings) ui.label(`${e.rank}. ${nameOf(e.userId, e.username)} — ${e.score}`);
      }, { padding: 14, spacing: 6 });
    }
    if (this.replaysEnabled) {
      ui.panel("recent", () => {
        ui.heading(T("Recent games"));
        if (!this.recent.length) ui.label(T("No finished games yet."), { tone: "muted" });
        for (const r of this.recent) {
          const opp = r.players.find((x) => x.userId !== player()?.userId);
          const res = r.result as { kind?: string; reason?: string; white?: string } | null;
          const myColor = res?.white === player()?.userId ? "white" : "black";
          const outcome = !res?.kind ? "" : res.kind === "draw" ? T("Drawn")
            : res.kind === "white" || res.kind === "black" ? (res.kind === myColor ? T("Won") : T("Lost")) : T("Abandoned");
          const label = [opp ? nameOf(opp.userId, opp.username) : "hal", outcome, reasonText(res?.reason)].filter(Boolean).join(" · ");
          if (ui.id(`replay-${r.sessionId}`).button(label)) nav.replay(r.sessionId);
        }
      }, { padding: 14, spacing: 6 });
    }
  }

  private friendDialog(): void {
    if (!this.friendPicker) return;
    const list = this.friendPicker;
    const open = ui.dialog("friend-picker", T("Invite a friend"), true, () => {
      if (!list.length) ui.label(T("No friends yet."), { tone: "muted" });
      for (const f of list) {
        if (ui.id(`friend-${f.userId}`).button(`${f.online ? "● " : "○ "}${nameOf(f.userId, f.username)}`)) {
          this.friendPicker = null;
          sessions.invite(f.userId).then(() => { toast(T("Invitation sent.")); this.refreshInvites(); },
            (e) => toast(T("Could not invite: {error}", { error: errorText(e) }), true));
        }
      }
      if (ui.id("friend-cancel").button(T("Cancel"))) this.friendPicker = null;
    });
    if (!open) this.friendPicker = null;
  }
}
