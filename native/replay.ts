// The replay viewer: a finished session's move log stepped through server.js.
import { frame } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { player, replays } from "starhermit:platform";
import { drawBoard, PALETTE } from "./board.js";
import { colorName, reasonText, T } from "./i18n.js";
import { replayMoves, type LoggedMove, type Position } from "./rules.js";
import { sfxForMove } from "./sfx.js";
import { errorText, nameOf, nav, splitLayout, toast, type Screen } from "./shell.js";

export class ReplayScreen implements Screen {
  private positions: Position[] = [];
  private moves: LoggedMove[] = [];
  private ply = 0;
  private white = "";
  private black = "";
  private resultLine = "";
  private flipped = false;
  private dropFocus = false;

  constructor(sessionId: string) {
    replays.get(sessionId).then((d) => {
      const s = d.state as { white?: string; black?: string; game?: { moves?: LoggedMove[] } } | null;
      this.moves = s?.game?.moves ?? [];
      this.positions = replayMoves(this.moves).positions;
      this.ply = this.positions.length - 1;
      this.white = s?.white ?? "";
      this.black = s?.black ?? "";
      this.flipped = this.black === player()?.userId;
      const res = d.result as { kind?: string; reason?: string } | null;
      this.resultLine = !res?.kind ? T("In progress")
        : (res.kind === "draw" ? T("Drawn") : T("{name} won", { name: this.name(res.kind === "white" ? this.white : this.black) || colorName(res.kind) }))
          + " — " + reasonText(res.reason);
    }, (e) => { toast(`${T("Could not open the replay.")} ${errorText(e)}`, true); nav.club(); });
  }

  private name(id: string): string { return id === "hal" ? "hal" : nameOf(id, ""); }

  private go(ply: number): void {
    const next = Math.max(0, Math.min(this.positions.length - 1, ply));
    if (next === this.ply + 1) sfxForMove(this.moves[this.ply]!.san);
    this.ply = next;
  }

  // The stepping keys always step (the screen has no text field), and take the
  // focus off the buttons so the widgets' own arrow navigation does not hold them.
  action(name: string): void {
    const to = name === "left" ? this.ply - 1 : name === "right" ? this.ply + 1
      : name === "row_start" ? 0 : name === "row_end" ? this.positions.length - 1 : null;
    if (to == null) return;
    this.go(to);
    this.dropFocus = true;
  }

  update(): void {
    if (this.dropFocus) { ui.setFocus(null); this.dropFocus = false; }
    const { scale } = frame();
    const layout = splitLayout();
    const pos = this.positions[this.ply];
    if (pos) {
      drawBoard(layout.board, { board: pos.board, flipped: this.flipped, last: pos.last, check: pos.check }, scale);
      const top = this.flipped ? this.white : this.black, bottom = this.flipped ? this.black : this.white;
      const size = 17 * scale;
      draw.text(`${this.name(top)} · ${colorName(this.flipped ? "white" : "black")}`, layout.board.x, layout.board.y - 36 * scale, { size, color: PALETTE.ink });
      draw.text(`${this.name(bottom)} · ${colorName(this.flipped ? "black" : "white")}`, layout.board.x, layout.board.y + layout.board.height + 12 * scale, { size, color: PALETTE.ink });
    } else {
      draw.text(T("Loading…"), layout.board.x, layout.board.y, { size: 18 * scale, color: PALETTE.muted });
    }
    ui.area(layout.side, () => {
      ui.column("replay", () => {
        if (ui.id("back").button(T("← Club"))) nav.club();
        ui.heading(T("Replay"));
        if (this.resultLine) ui.label(this.resultLine, { tone: "accent" });
        ui.row("replay-controls", () => {
          if (ui.id("first").button("|◀")) this.go(0);
          if (ui.id("prev").button("◀")) this.go(this.ply - 1);
          if (ui.id("next").button("▶")) this.go(this.ply + 1);
          if (ui.id("last").button("▶|")) this.go(this.positions.length - 1);
          ui.label(`${this.ply} / ${Math.max(0, this.positions.length - 1)}`, { tone: "muted" });
        }, { spacing: 8, align: "center" });
        ui.scrollArea("replay-moves", { width: 340, height: 260 }, () => {
          for (let i = 0; i < this.moves.length; i += 2) {
            ui.row(`mv-${i}`, () => {
              ui.label(`${i / 2 + 1}.`, { tone: "muted" });
              if (ui.id(`ply-${i + 1}`).button(this.moves[i]!.san, { tone: this.ply === i + 1 ? "accent" : "normal" })) this.go(i + 1);
              const b = this.moves[i + 1];
              if (b && ui.id(`ply-${i + 2}`).button(b.san, { tone: this.ply === i + 2 ? "accent" : "normal" })) this.go(i + 2);
            }, { spacing: 6, align: "center" });
          }
        });
      }, { spacing: 12 });
    });
  }
}
