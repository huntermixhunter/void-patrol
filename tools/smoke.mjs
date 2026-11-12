// Launch the desktop app headlessly, start a run, and fail on any load or JavaScript error.
// Usage: npm run smoke [path-to-packaged-executable]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const target = process.argv[2];
const command = target || require('electron');
const args = target ? [] : ['.'];
const out = new URL('../build-output/smoke', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, VOID_PATROL_SMOKE: out }, timeout: 60000 });
if (result.error) { console.error(result.error); process.exit(1); }
process.exit(result.status ?? 1);
