// Native client checks on the StarHermit engine: `starhermit check .` (manifest,
// package, 120 headless frames), then every tests/native/*.play script as a
// signed-out offscreen run (offline practice against hal through server.js).
// The engine is Windows-only (1.0.0): point STARHERMIT at starhermit.exe
// (WSL runs it directly). Skipped when STARHERMIT is unset.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.STARHERMIT;
if (!exe) {
  console.log('SKIP native: set STARHERMIT to the engine runtime (starhermit.exe)');
  process.exit(0);
}

const run = (args) => execFileSync(exe, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let failed = 0;
function step(name, args) {
  try { run(args); console.log(`ok - ${name}`); }
  catch (e) { failed++; console.log(`not ok - ${name}\n${(e.stderr || e.stdout || e.message).trim()}`); }
}

step('starhermit check', ['check', '.']);
for (const f of readdirSync(join(root, 'tests', 'native')).filter((n) => n.endsWith('.play')).sort()) {
  step(f, ['.', '--render-check', '--guest', '--script', `tests/native/${f}`]);
}
console.log(failed ? `NATIVE FAIL — ${failed} failed` : 'NATIVE PASS');
process.exit(failed ? 1 : 0);
