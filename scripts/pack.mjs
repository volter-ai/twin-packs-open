import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';

const pack = selectedPack();
mkdirSync(pack.release, { recursive: true });
const result = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', pack.release], {
  cwd: pack.directory, stdio: 'inherit',
});
process.exit(result.status ?? 1);
