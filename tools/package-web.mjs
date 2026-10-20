// Writes the web loader (index.html) and the file index (starhermit-files.json)
// with `starhermit package --web`, from the files git would commit — the same
// tree the platform clones — so local-only folders (node_modules, .starhermit)
// never reach the index. Run after every change, then commit both files:
//   STARHERMIT=/path/to/starhermit.exe npm run package
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.STARHERMIT;
if (!exe) { console.error('set STARHERMIT to the engine runtime (starhermit.exe)'); process.exit(1); }

const OUT = ['index.html', 'starhermit-files.json'];
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--deduplicate'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((f) => f && !OUT.includes(f));
const dir = mkdtempSync(join(tmpdir(), 'chess-web-'));
try {
  for (const f of files) {
    try { mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(join(root, f), join(dir, f)); }
    catch (e) { if (e.code !== 'ENOENT') throw e; } // deleted but not yet staged
  }
  execFileSync(exe, ['package', '--web', '.'], { cwd: dir, stdio: 'inherit' });
  for (const f of OUT) copyFileSync(join(dir, f), join(root, f));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
