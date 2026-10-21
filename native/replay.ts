// The replay viewer: a finished session's move log stepped through server.js.
import { frame } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { player, replays } from "starhermit:platform";
import { drawBoard, PALETTE } from "./board.js";
import { colorName, reasonText, T } from "./i18n.js";
import { replayMoves, type LoggedMove, type Position } from "./rules.js";
import { sfxForMove } from "./sfx.js";
import { errorText, nameOf, nav, scrollPanel, splitLayout, toast, type Screen } from "./shell.js";

export class ReplayScreen implements Screen {
  private positions: Position[] = [];
  private moves: LoggedMove[] = [];
  private ply = 0;
  /** Set when the ply changes: the scoresheet brings its move into view. */
  private follow = false;
  private scrollTop: number | null = null;
  /** Window pixels from one scoresheet row to the next, once measured. */
  private pitch = 0;
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
        : (res.kind === "draw" ? T("Drawn")
          : res.kind === "white" || res.kind === "black" ? T("{name} won", { name: this.name(res.kind === "white" ? this.white : this.black) || colorName(res.kind) })
          : T("Abandoned"))
          + (res.reason ? " — " + reasonText(res.reason) : "");
    }, (e) => { toast(`${T("Could not open the replay.")} ${errorText(e)}`, true); nav.club(); });
  }

  private name(id: string): string { return id === "hal" ? "hal" : nameOf(id, ""); }

  private go(ply: number): void {
    const next = Math.max(0, Math.min(this.positions.length - 1, ply));
    if (next === this.ply + 1) sfxForMove(this.moves[this.ply]!.san);
    if (next !== this.ply) this.follow = true;
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
    scrollPanel("replay-scroll", layout.side, () => {
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
        const scrollTo = this.scrollTop == null ? undefined : { scrollTo: { top: this.scrollTop, behavior: "smooth" as const } };
        this.scrollTop = null;
        const currentRow = this.ply <= 1 ? 0 : Math.floor((this.ply - 1) / 2);
        const tops: number[] = [];
        const sheet = ui.scrollArea("replay-moves", { width: 340, height: 260 }, () => {
          for (let i = 0; i < this.moves.length; i += 2) {
            const row = ui.row(`mv-${i}`, () => {
              ui.label(`${i / 2 + 1}.`, { tone: "muted" });
              if (ui.id(`ply-${i + 1}`).button(this.moves[i]!.san, { tone: this.ply === i + 1 ? "accent" : "normal" })) this.go(i + 1);
              const b = this.moves[i + 1];
              if (b && ui.id(`ply-${i + 2}`).button(b.san, { tone: this.ply === i + 2 ? "accent" : "normal" })) this.go(i + 2);
            }, { spacing: 6, align: "center" });
            if (i < 4) tops.push(row.y);
          }
        }, scrollTo);
        // Rows are evenly spaced: the first two give the pitch (measured while
        // they show), which places the current row.
        if (tops.length >= 2 && tops[1]! - tops[0]! > 0) this.pitch = tops[1]! - tops[0]!;
        if (this.follow && this.pitch > 0) {
          this.follow = false;
          const top = currentRow * this.pitch;
          if (top < sheet.scrollTop || top + this.pitch > sheet.scrollTop + sheet.clientHeight) {
            this.scrollTop = Math.max(0, top - (sheet.clientHeight - this.pitch) / 2);
          }
        }
      }, { spacing: 12 });
    });
  }
}
