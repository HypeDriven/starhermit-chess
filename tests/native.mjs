// Native client checks on the StarHermit engine: `starhermit check .` (manifest,
// package, browser module linking, 120 headless frames; any warning fails),
// then every tests/native/*.play script as a signed-out offscreen run (offline practice against hal through server.js).
// Also checks that the committed web index (starhermit-files.json) matches the
// files, i.e. that `npm run package` ran after the last change. Point
// STARHERMIT at the Windows runtime (WSL runs it directly); without it only
// the index check runs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.STARHERMIT;

const { files: index, excluded = [] } = JSON.parse(readFileSync(join(root, 'starhermit-files.json'), 'utf8'));
const left = (f) => excluded.some((e) => (e.endsWith('/') ? f.startsWith(e) : f === e));
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--deduplicate'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((f) => f && f !== 'starhermit-files.json' && !left(f) && !f.split('/').some((p) => p.startsWith('.')));
const stale = tracked.filter((f) => {
  let data; try { data = readFileSync(join(root, f)); } catch { return false; }
  return !index[f] || index[f].sha256 !== createHash('sha256').update(data).digest('hex');
}).concat(Object.keys(index).filter((f) => !tracked.includes(f)));
if (stale.length) { console.log(`not ok - web index is stale (run npm run package): ${stale.join(', ')}`); process.exit(1); }
console.log('ok - web index matches the files');
if (!exe) {
  console.log('SKIP engine checks: set STARHERMIT to the engine runtime (starhermit.exe)');
  process.exit(0);
}

const run = (args) => execFileSync(exe, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let failed = 0;
function step(name, args) {
  try { run(args); console.log(`ok - ${name}`); }
  catch (e) { failed++; console.log(`not ok - ${name}\n${(e.stderr || e.stdout || e.message).trim()}`); }
}

try {
  const out = execFileSync(exe, ['check', '.', '--quiet'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const warnings = out.split('\n').filter((l) => l.startsWith('warning'));
  if (warnings.length) { failed++; console.log(`not ok - starhermit check warns\n${warnings.join('\n')}`); }
  else console.log('ok - starhermit check');
} catch (e) { failed++; console.log(`not ok - starhermit check\n${(e.stderr || e.stdout || e.message).trim()}`); }
for (const f of readdirSync(join(root, 'tests', 'native')).filter((n) => n.endsWith('.play')).sort()) {
  step(f, ['.', '--render-check', '--guest', '--script', `tests/native/${f}`]);
}
console.log(failed ? `NATIVE FAIL — ${failed} failed` : 'NATIVE PASS');
process.exit(failed ? 1 : 0);
