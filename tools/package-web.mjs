// Writes the web loader (index.html) and the file index (starhermit-files.json)
// into the game's folder with `starhermit package --web .` — the folder is the
// repository the platform clones. The engine leaves development files out of
// the package (its default rules plus .starhermitignore). Run after every
// change, then commit both files:
//   STARHERMIT=/path/to/starhermit.exe npm run package
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.STARHERMIT;
if (!exe) { console.error('set STARHERMIT to the engine runtime (starhermit.exe)'); process.exit(1); }
execFileSync(exe, ['package', '--web', '.'], { cwd: root, stdio: 'inherit' });
