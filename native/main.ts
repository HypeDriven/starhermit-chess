// StarHermit Chess: the entry module the StarHermit engine runs
// (starhermit.txt engine.entry), natively in the Windows client and in
// browsers on the engine's web runtime; both speak to the same server.js.
import { onRender, onStart, onUpdate } from "starhermit:engine";
import { Color, PerspectiveCamera, renderer, scene } from "starhermit:scene";
import { onAction, onKey, onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { launchContext, onPlayerChange, onSessionEnded, player, sessions } from "starhermit:platform";
import { PALETTE } from "./board.js";
import { ClubScreen } from "./club.js";
import { T } from "./i18n.js";
import { ReplayScreen } from "./replay.js";
import { loadSfx } from "./sfx.js";
import { drawToasts, nav, screen, setTheme, show, toast } from "./shell.js";
import { TableScreen } from "./table.js";

nav.club = () => show(new ClubScreen());
nav.table = (sessionId) => show(new TableScreen(sessionId));
nav.practice = (resume) => show(new TableScreen(null, resume));
nav.replay = (sessionId) => show(new ReplayScreen(sessionId));

const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 10);
renderer.camera = camera;
scene.background = new Color(PALETTE.bg);

onStart(() => {
  setTheme();
  void loadSfx(); // the board needs no sound to start; clips load behind it
  nav.club();
  // Launched for a session (an invite accepted on the dashboard): open its
  // table once, if it is still on.
  const sessionId = launchContext()?.sessionId;
  if (sessionId && player()) {
    sessions.get(sessionId).then((s) => { if (s && s.status === "active") nav.table(sessionId); }, () => { /* stay in the club */ });
  }
});

onPlayerChange(() => nav.club());
onSessionEnded((reason) => {
  toast(reason === "terms-required" ? T("Accept the updated terms in StarHermit to keep playing.") : T("Your session has expired."), true);
});

// A press outside the widgets goes to the screen (the board); a press on a
// widget tells the screen too, so the board gives the keyboard back. Touch and the
// mouse can both report one tap, so a pointer press right after a touch is skipped.
let lastTouch = -1;
onTouch((e) => {
  if (e.phase !== "start" || !e.primary) return;
  if (ui.pointerOver()) { screen()?.widgetPress?.(); return; }
  lastTouch = performance.now();
  screen()?.press?.(e.x, e.y);
});
onPointerButton((e) => {
  if (!e.pressed || e.button !== 0) return;
  if (ui.pointerOver()) { screen()?.widgetPress?.(); return; }
  if (performance.now() - lastTouch < 600) return;
  screen()?.press?.(e.x, e.y);
});
onAction((e) => { if (e.pressed) screen()?.action?.(e.action); });
onKey((e) => { if (e.pressed && !e.repeat) screen()?.key?.(e.code); });

onUpdate(() => { screen()?.update(); });
onRender(() => { drawToasts(); });
