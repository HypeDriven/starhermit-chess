// Native client checks on the StarHermit engine: `starhermit check .` (manifest,
// package, browser module linking, 120 headless frames; any warning fails),
// then every tests/native/*.play script as a signed-out offscreen run (offline
// practice against hal through server.js).
// Also checks that the committed web index (starhermit-files.json) matches the
// files, i.e. that `npm run package` ran after the last change, and that every
// client string has its translations in strings.js (T("…") literals and lists
// marked `// translated:`). Point STARHERMIT at the Windows runtime (WSL runs it
// directly); without it only those two checks run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.STARHERMIT;

// Every string the client translates (T("…") and the hint/how-to tables) has
// a row in strings.js for each table locale.
globalThis.self = globalThis;
await import(join(root, 'strings.js'));
const tables = globalThis.CH_STRINGS;
const untranslated = [];
for (const f of readdirSync(join(root, 'native')).filter((n) => n.endsWith('.ts'))) {
  const src = readFileSync(join(root, 'native', f), 'utf8');
  const keys = [...src.matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  for (const m of src.matchAll(/\/\/ translated:\n([\s\S]*?)\n[\]}];/g)) keys.push(...[...m[1].matchAll(/"((?:[^"\\]|\\.)*)"(\s*:)?/g)].filter((x) => !x[2]).map((x) => x[1]));
  for (const k of keys) for (const loc of ['es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT']) {
    if (!(k in tables[loc])) untranslated.push(`${f}: ${loc} "${k}"`);
  }
}
// The achievements server.js declares have their texts in i18n.ts (keyed by achievement).
new Function(readFileSync(join(root, 'server.js'), 'utf8'))();
const i18nSrc = readFileSync(join(root, 'native', 'i18n.ts'), 'utf8');
for (const a of globalThis.game.achievements) {
  const line = i18nSrc.split('\n').find((l) => l.includes(`"${a.key}": {`)) ?? '';
  if (!line.includes(JSON.stringify(a.name)) || !line.includes(JSON.stringify(a.description))) {
    untranslated.push(`i18n.ts: achievement "${a.key}" differs from server.js`);
  }
}
if (untranslated.length) { console.log(`not ok - untranslated strings\n${untranslated.join('\n')}`); process.exit(1); }
console.log('ok - every client string is translated');

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
