// The game screen. Online it talks to the platform's game socket; offline
// practice runs server.js itself as a local authority, so both paths receive
// the same broadcasts and this screen has one code path.
import { frame, type JsonValue } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import {
  chat, connectGame, gameInfo, leaderboards, player, sessions, voice,
  type ChatChannel, type ChatMessage,
} from "starhermit:platform";
import { authority } from "starhermit:script";
import { drawBoard, moveFocus, PALETTE, squareAt } from "./board.js";
import { colorName, fmtLeft, reasonText, T } from "./i18n.js";
import { checkSquare, replayMoves, rules, type Color, type GameState, type LoggedMove, type Move } from "./rules.js";
import { sfx, sfxForMove } from "./sfx.js";
import { errorText, loadName, nameOf, nav, short, splitLayout, toast, type Screen } from "./shell.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PRACTICE_ME = "you";
const PRACTICE_HAL = "hal";

/** server.js publicSessionView. */
interface View {
  white: string;
  black: string;
  ratings: { white: number; black: number };
  board: string;
  turn: Color;
  moves: LoggedMove[];
  status: "active" | "finished";
  result: { kind: string; reason: string } | null;
  deadline: number;
  drawOfferBy: Color | null;
  ai: Color | null;
  aiName: string | null;
}

interface Link {
  send(cmd: JsonValue): boolean;
  close(): void;
}

type Pending = { at: number; data: { [k: string]: JsonValue } };

const RULE_MESSAGES = [
  "Malformed square.", "Invalid promotion piece.", "Promotion piece required (q, r, b or n).",
  "Illegal move.", "No such session.", "You are not a player in this game.", "Game is over.",
  "Not your turn.", "Draw already offered.", "No draw offer to accept.", "No draw offer to decline.",
  "Command rejected.",
];

export class TableScreen implements Screen {
  private link: Link;
  private view: View | null = null;
  private game: GameState = rules.newGameState();
  private me: string;
  private selected = -1;
  private dests: Move[] = [];
  private focus: number | null = null;
  private promo: { from: number; to: number } | null = null;
  private confirm: "resign" | "draw" | null = null;
  private over: { title: string; reason: string; rating: string; rank: string } | null = null;
  private awaitingEcho = false;
  private conn: "connecting" | "open" | "reconnecting" | "closed" = "connecting";
  private oppOnline: boolean | null = null;
  private warned = false;
  private queue: Pending[] = [];
  private eloBefore: number | null = null;
  private replaysEnabled = true;
  // table talk (online, human opponents only)
  private channel: ChatChannel | null = null;
  private messages: ChatMessage[] = [];
  private draft = "";
  private conversationId: string | null = null;
  private voiceOn = false;
  private failure = "";

  constructor(private readonly sessionId: string | null) {
    const p = player();
    this.me = sessionId ? p!.userId : PRACTICE_ME;
    this.link = sessionId ? this.connect(sessionId) : this.practice(p?.displayName ?? T("You"));
  }

  // -- Connections ----------------------------------------------------------------
  private connect(sessionId: string): Link {
    const socket = connectGame(sessionId);
    socket.on("open", () => { this.conn = "open"; socket.sendCommand({ type: "sync" }); });
    socket.on("disconnected", () => { this.conn = "reconnecting"; });
    socket.on("resumed", () => { socket.sendCommand({ type: "sync" }); });
    socket.on("stopped", (reason) => {
      this.conn = "closed";
      if (reason === "build-mismatch") toast(T("The game was updated — restart it to keep playing."), true);
    });
    socket.on("game", (data) => this.receive(data));
    socket.on("error", (message) => this.refused(message));
    socket.on("presence", (userId, online) => { if (userId !== this.me) this.oppOnline = online; });
    socket.on("abandoned", () => { toast(reasonText("abandoned")); });
    sessions.get(sessionId).then(async (s) => {
      if (!s) return;
      for (const pl of s.players) loadName(pl.userId);
      if (s.chatConversationId) await this.openChat(s.chatConversationId);
    }, () => { /* the board works without the session's details */ });
    gameInfo().then((info) => {
      this.eloBefore = info.me?.elo ?? null;
      this.replaysEnabled = info.replaysEnabled;
    }, () => { /* rating lines stay empty */ });
    return { send: (c) => socket.sendCommand(c), close: () => socket.close() };
  }

  private practice(myName: string): Link {
    const a = authority("server.js", {
      context: {
        sessionId: "practice",
        players: [{ id: PRACTICE_ME, name: myName }, { id: PRACTICE_HAL, name: "hal", ai: true }],
        sessionState: null,
        playerStates: {},
      },
      player: PRACTICE_ME,
    });
    a.on("open", () => { this.conn = "open"; });
    a.on("game", (data) => this.receive(data));
    a.on("error", (message) => { if (this.conn === "open") this.refused(message); else this.failure = message; });
    a.on("stopped", (reason) => { if (reason === "failed") { this.conn = "closed"; toast(T("Practice could not start."), true); } });
    return { send: (c) => a.sendCommand(c), close: () => a.close() };
  }

  private async openChat(conversationId: string): Promise<void> {
    if (this.view?.ai) return;
    try {
      const page = await chat.messages(conversationId, { pageSize: 30 });
      this.messages = page.items.slice().sort((a, b) => a.sentAt - b.sentAt);
    } catch { /* start empty */ }
    this.conversationId = conversationId;
    this.channel = chat.subscribe(conversationId);
    this.channel.on("message", (m) => {
      if (this.messages.some((x) => x.id === m.id)) return;
      this.messages.push(m);
      if (this.messages.length > 60) this.messages.shift();
      if (m.senderId !== this.me) sfx("chat");
    });
  }

  dispose(): void {
    this.link.close();
    this.channel?.close();
    if (this.voiceOn) void voice.leave();
  }

  // -- Server messages --------------------------------------------------------------
  private receive(raw: JsonValue): void {
    const data = raw as { [k: string]: JsonValue };
    // hal answers inside the same invocation as the move it answers; a short
    // pause makes the reply read as a reply. Later messages keep their order.
    const halMove = data.type === "moved" && this.view?.ai && data.by === this.view.ai;
    const last = this.queue.length ? this.queue[this.queue.length - 1]!.at : 0;
    const at = halMove ? Math.max(last, frame().time) + 0.45 + Math.random() * 0.5 : last;
    if (at > frame().time || this.queue.length) this.queue.push({ at, data });
    else this.apply(data);
  }

  private apply(data: { [k: string]: JsonValue }): void {
    switch (data.type) {
      case "state":
        this.setView(data as unknown as View);
        break;
      case "moved":
        this.awaitingEcho = false;
        sfxForMove(String(data.san));
        this.setView(data.view as unknown as View);
        break;
      case "game-over":
        this.setView(data.view as unknown as View);
        this.finished();
        break;
      case "draw-offered":
        // Platform messages arrive frozen in browsers: replace, never mutate.
        if (this.view) this.view = { ...this.view, drawOfferBy: data.by as Color };
        if (data.by !== this.myColor()) sfx("drawOffer");
        break;
      case "draw-declined":
        if (this.view) this.view = { ...this.view, drawOfferBy: null };
        if (data.by !== this.myColor()) toast(this.view?.ai ? T("hal declines the draw.") : T("{name} declines the draw.", { name: this.oppName() }));
        break;
    }
  }

  private refused(message: string): void {
    console.warn(`refused: ${message}`);
    this.awaitingEcho = false;
    sfx("illegal");
    toast(RULE_MESSAGES.includes(message) ? T(message) : message, true);
  }

  private setView(v: View): void {
    const first = !this.view;
    this.view = v;
    this.game = replayMoves(v.moves).game;
    this.selected = -1;
    this.dests = [];
    this.promo = null;
    if (first && v.status === "finished" && v.result) this.finished(false);
  }

  private finished(withSound = true): void {
    const v = this.view!;
    const res = v.result!;
    const mine = this.myColor();
    const won = res.kind === mine, drawn = res.kind === "draw";
    if (withSound) sfx(drawn ? "draw" : won ? "win" : "lose");
    this.over = {
      title: drawn ? T("Drawn") : won ? T("You won") : T("You lost"),
      reason: reasonText(res.reason),
      rating: "",
      rank: "",
    };
    if (!this.sessionId) return;
    const over = this.over;
    const before = this.eloBefore;
    // The platform publishes the new rating as the session ends; ask a moment later.
    setTimeout(() => {
      gameInfo().then((info) => {
        const elo = info.me?.elo;
        if (elo == null) return;
        const d = before == null ? null : elo - before;
        over.rating = T("Rating: {elo}", { elo }) + (d == null ? "" : ` (${d >= 0 ? "+" : ""}${d})`);
      }, () => { /* no rating line */ });
      if (v.ai && won) this.practiceRank(over);
    }, 1500);
  }

  private async practiceRank(over: { rank: string }): Promise<void> {
    try {
      const board = (await leaderboards.list()).find((b) => b.key === "practice-wins");
      if (!board) return;
      const page = await leaderboards.entries(board.id, { pageSize: 100 });
      const mine = page.items.find((e) => e.userId === this.me);
      if (mine) over.rank = T("Practice wins: {score} — rank #{rank}", { score: mine.score, rank: mine.rank });
    } catch { /* no rank line */ }
  }

  // -- Helpers ----------------------------------------------------------------------------
  private myColor(): Color | null {
    const v = this.view;
    if (!v) return null;
    return v.white === this.me ? "white" : v.black === this.me ? "black" : null;
  }
  private oppId(): string | null {
    const v = this.view;
    return v ? (v.white === this.me ? v.black : v.white) : null;
  }
  private oppName(): string {
    const v = this.view;
    if (!v) return "…";
    const opp: Color = this.myColor() === "white" ? "black" : "white";
    if (v.ai === opp) return v.aiName ?? "hal";
    return nameOf(this.oppId());
  }
  private canMove(): boolean {
    const v = this.view;
    return !!v && v.status === "active" && v.turn === this.myColor() && !this.awaitingEcho && !this.queue.length;
  }
  private flipped(): boolean { return this.myColor() === "black"; }

  // -- Input ----------------------------------------------------------------------------
  private clickSquare(i: number): void {
    if (!this.canMove() || i < 0) return;
    const p = this.game.board[i]!;
    if (this.selected >= 0) {
      const moves = this.dests.filter((m) => m.to === i);
      if (moves.length) {
        if (moves.some((m) => m.promo)) this.promo = { from: this.selected, to: i };
        else this.sendMove(this.selected, i, null);
        return;
      }
    }
    if (p !== "." && rules.pieceColor(p) === this.myColor() && i !== this.selected) {
      this.selected = i;
      this.dests = rules.legalMovesFrom(this.game, i);
      sfx("select");
      return;
    }
    this.selected = -1;
    this.dests = [];
  }

  private sendMove(from: number, to: number, promo: string | null): void {
    const sent = this.link.send({ type: "move", from: rules.algebraic(from), to: rules.algebraic(to), promo });
    if (!sent) { toast(T("Too fast — try again."), true); return; }
    this.awaitingEcho = true;
    this.selected = -1;
    this.dests = [];
    this.promo = null;
  }

  press(x: number, y: number): void {
    if (this.promo || this.confirm || this.over) return;
    this.focus = null;
    this.clickSquare(squareAt(splitLayout().board, this.flipped(), x, y));
  }

  action(name: string): void {
    if (this.promo || this.confirm || this.over || ui.capturingKeys()) return;
    // The board owns the arrows and Select once it has the focus square
    // (update() keeps the widgets unfocused); Tab or Back hands them back.
    if (this.focus == null && ui.focused() !== null) return;
    const f = this.flipped();
    const at = this.focus ?? (this.selected >= 0 ? this.selected : (f ? 60 : 4));
    switch (name) {
      case "up": this.focus = moveFocus(at, f, 0, -1); break;
      case "down": this.focus = moveFocus(at, f, 0, 1); break;
      case "left": this.focus = moveFocus(at, f, -1, 0); break;
      case "right": this.focus = moveFocus(at, f, 1, 0); break;
      case "row_start": this.focus = moveFocus(at, f, -7, 0); break;
      case "row_end": this.focus = moveFocus(at, f, 7, 0); break;
      case "select": if (this.focus != null) this.clickSquare(this.focus); else this.focus = at; break;
    }
  }

  // -- Frame --------------------------------------------------------------------------
  /** Tab moves the keyboard from the board back to the widgets. */
  key(code: string): void {
    if (code === "Tab") this.focus = null;
  }

  update(): void {
    // A dialog takes the keyboard from the board.
    if (this.promo || this.confirm || this.over) this.focus = null;
    if (this.focus != null) {
      if (ui.back()) this.focus = null;
      else ui.setFocus(null);
    }
    while (this.queue.length && this.queue[0]!.at <= frame().time) this.apply(this.queue.shift()!.data);
    const { scale } = frame();
    const layout = splitLayout();
    const v = this.view;
    const mine = this.myColor();

    if (!v) {
      draw.text(T("Connecting…"), layout.board.x, layout.board.y, { size: 18 * scale, color: PALETTE.muted });
    } else {
      const last = v.moves.length ? v.moves[v.moves.length - 1]! : null;
      drawBoard(layout.board, {
        board: v.board,
        flipped: this.flipped(),
        selected: this.selected,
        dests: this.dests.filter((m, i, all) => all.findIndex((n) => n.to === m.to) === i)
          .map((m) => ({ to: m.to, cap: v.board[m.to] !== "." || !!m.isEp })),
        last: last ? { from: rules.parseSquare(last.from), to: rules.parseSquare(last.to) } : null,
        check: checkSquare(this.game),
        focus: this.focus,
      }, scale);
      this.seats(layout.board, v, mine);
    }

    ui.area(layout.side, () => {
      ui.column("table", () => {
        ui.row("table-top", () => {
          if (ui.id("back").button(T("← Club"))) nav.club();
          if (v && v.status === "active" && mine) {
            if (ui.id("draw").button(T("Offer draw"), { disabled: v.drawOfferBy === mine })) this.confirm = "draw";
            if (ui.id("resign").button(T("Resign"), { tone: "danger" })) this.confirm = "resign";
          }
        }, { spacing: 8 });
        if (v) this.clock(v, mine);
        if (v) this.drawBanner(v, mine);
        this.scoresheet(v);
        if (this.sessionId && v && !v.ai) this.chatPanel();
        else ui.label(this.sessionId ? T("No table talk with hal.") : T("Offline practice — no clock, no rating."), { tone: "muted" });
      }, { spacing: 12 });
    });

    this.dialogs(v);
  }

  private seats(board: { x: number; y: number; width: number; height: number }, v: View, mine: Color | null): void {
    const { scale } = frame();
    const size = 17 * scale;
    const oppColor: Color = mine === "white" ? "black" : "white";
    const myColor: Color = mine ?? "white";
    const meName = this.sessionId ? nameOf(this.me, T("You")) : (player()?.displayName ?? T("You"));
    const rated = !!this.sessionId;
    const dot = this.oppOnline == null || v.ai === oppColor ? "" : this.oppOnline ? "● " : "○ ";
    const opp = `${dot}${short(this.oppName(), 28)}${rated ? `  ${v.ratings[oppColor]}` : ""}  · ${colorName(oppColor)}`;
    draw.text(opp, board.x, board.y - 36 * scale, { size, color: PALETTE.ink });
    let you = `${short(meName, 28)}${rated ? `  ${v.ratings[myColor]}` : ""}  · ${colorName(myColor)}`;
    if (v.status === "active" && v.turn === myColor && checkSquare(this.game) >= 0) you += `   ${T("Check")}`;
    draw.text(you, board.x, board.y + board.height + 12 * scale, { size, color: PALETTE.ink });
  }

  private clock(v: View, mine: Color | null): void {
    if (v.status !== "active") {
      if (v.result) ui.label(`${v.result.kind === "draw" ? T("Drawn") : T("{name} won", { name: colorName(v.result.kind) })} — ${reasonText(v.result.reason)}`);
      return;
    }
    const myTurn = v.turn === mine;
    ui.heading(myTurn ? T("Your move") : T("{name} to move", { name: short(this.oppName()) }));
    if (!this.sessionId) return; // offline practice has no clock
    const left = Math.max(0, v.deadline - Date.now());
    const urgent = left < HOUR_MS;
    ui.label(T("{time} left", { time: fmtLeft(left) }), { tone: urgent ? "danger" : "muted" });
    ui.progress(left / DAY_MS);
    if (myTurn && urgent && !this.warned) { this.warned = true; sfx("clockWarning"); }
  }

  private drawBanner(v: View, mine: Color | null): void {
    if (v.status !== "active" || !v.drawOfferBy) return;
    if (v.drawOfferBy === mine) {
      ui.label(T("Draw offered — waiting for {name}", { name: this.oppName() }), { tone: "muted" });
      return;
    }
    ui.panel("draw-banner", () => {
      ui.label(T("{name} offers a draw", { name: this.oppName() }), { tone: "accent" });
      ui.row("draw-answer", () => {
        if (ui.id("accept-draw").button(T("Accept"))) this.link.send({ type: "accept-draw" });
        if (ui.id("decline-draw").button(T("Decline"))) this.link.send({ type: "decline-draw" });
      }, { spacing: 8 });
    }, { padding: 10, spacing: 8 });
  }

  private scoresheet(v: View | null): void {
    const moves = v?.moves ?? [];
    ui.scrollArea("scoresheet", { width: 340, height: 180 }, () => {
      if (!moves.length) ui.label(T("No moves yet."), { tone: "muted" });
      for (let i = 0; i < moves.length; i += 2) {
        const black = moves[i + 1];
        ui.label(`${i / 2 + 1}.  ${moves[i]!.san}${black ? `   ${black.san}` : ""}`);
      }
      if (this.conn === "connecting") ui.label(T("connecting…"), { tone: "muted" });
      if (this.conn === "reconnecting") ui.label(T("reconnecting…"), { tone: "muted" });
      if (this.conn === "closed") ui.label(T("connection closed"), { tone: "danger" });
      if (this.conn === "closed" && this.failure) ui.paragraph(this.failure, 320);
    });
  }

  private chatPanel(): void {
    ui.heading(T("Table talk"));
    ui.scrollArea("chat", { width: 340, height: 140 }, () => {
      for (const m of this.messages.slice(-30)) {
        if (m.isDeleted) continue;
        ui.paragraph(`${m.senderId === this.me ? T("You") : nameOf(m.senderId)}: ${m.content}`, 320);
      }
    });
    this.draft = ui.textField("chat-input", this.draft, { maxChars: 500, placeholder: T("Say something…"), width: 340 });
    if (ui.submitted("chat-input") && this.draft.trim()) {
      if (this.channel?.send(this.draft.trim())) this.draft = "";
    }
    if (this.conversationId) this.voicePanel(this.conversationId);
  }

  // Voice is opt-in per game (open mic), off until the player enables it.
  private voicePanel(conversationId: string): void {
    ui.heading(T("Voice"));
    const st = voice.status();
    if (!this.voiceOn) {
      if (ui.id("voice-on").button(T("Enable voice"))) {
        this.voiceOn = true;
        voice.join(conversationId).then(() => voice.setMode("open-mic"), (e) => {
          this.voiceOn = false;
          toast(`${T("Voice is unavailable.")} ${errorText(e)}`, true);
        });
      }
      return;
    }
    ui.row("voice-controls", () => {
      if (ui.id("voice-mute").button(st.muted ? T("Unmute") : T("Mute"))) voice.setMuted(!st.muted);
      if (ui.id("voice-off").button(T("Leave voice"))) { this.voiceOn = false; void voice.leave(); }
      if (st.connection !== "connected") ui.label(st.connection === "failed" ? T("voice failed") : T("connecting…"), { tone: st.connection === "failed" ? "danger" : "muted" });
    }, { spacing: 8, align: "center" });
    for (const p of st.participants) {
      const marks = (p.speaking ? " ●" : "") + (p.muted || p.serverMuted ? ` (${T("muted")})` : "");
      ui.label(`${p.userId === this.me ? T("You") : nameOf(p.userId)}${marks}`, { tone: p.speaking ? "accent" : "normal" });
    }
  }

  private dialogs(v: View | null): void {
    if (this.promo) {
      const promo = this.promo;
      const white = this.myColor() === "white";
      const open = ui.dialog("promotion", T("Promote to"), true, () => {
        ui.row("promo-choices", () => {
          for (const [p, label] of [["q", T("Queen")], ["r", T("Rook")], ["n", T("Knight")], ["b", T("Bishop")]] as const) {
            if (ui.id(`promo-${p}`).button(`${white ? p.toUpperCase() : p}  ${label}`)) this.sendMove(promo.from, promo.to, p);
          }
        }, { spacing: 8 });
      });
      if (!open) this.promo = null;
    }
    if (this.confirm) {
      const kind = this.confirm;
      const open = ui.dialog("confirm", kind === "resign" ? T("Resign this game?") : T("Offer a draw to {name}?", { name: this.oppName() }), true, () => {
        ui.row("confirm-row", () => {
          if (ui.id("confirm-yes").button(kind === "resign" ? T("Resign") : T("Offer draw"), { tone: kind === "resign" ? "danger" : "normal" })) {
            this.link.send({ type: kind === "resign" ? "resign" : "offer-draw" });
            this.confirm = null;
          }
          if (ui.id("confirm-no").button(T("Cancel"))) this.confirm = null;
        }, { spacing: 8 });
      });
      if (!open) this.confirm = null;
    }
    if (this.over && v) {
      const over = this.over;
      const open = ui.dialog("game-over", over.title, true, () => {
        ui.label(over.reason);
        if (over.rating) ui.label(over.rating, { tone: "accent" });
        if (over.rank) ui.label(over.rank, { tone: "muted" });
        ui.row("over-row", () => {
          if (this.sessionId && this.replaysEnabled && ui.id("over-replay").button(T("View replay"))) nav.replay(this.sessionId);
          if (ui.id("over-club").button(T("Back to the club"))) nav.club();
          if (ui.id("over-board").button(T("Look at the board"))) this.over = null;
        }, { spacing: 8 });
      });
      if (!open) this.over = null;
    }
  }
}
