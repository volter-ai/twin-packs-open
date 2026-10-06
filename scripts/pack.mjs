import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';

const pack = selectedPack();
mkdirSync(pack.release, { recursive: true });
const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', pack.release], {
  cwd: pack.directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'npm pack failed\n');
  process.exit(result.status ?? 1);
}
const packed = JSON.parse(result.stdout);
if (packed.length !== 1) throw new Error('npm pack must produce one selected artifact');
const artifact = packed[0];
if (artifact.name !== pack.manifest.name || artifact.version !== pack.manifest.version) throw new Error('Packed package identity differs from the selected release');
const files = new Set(artifact.files.map((file) => file.path));
for (const required of ['generated/pack-facts.json', 'dist/src/index.js', 'src/manifest.ts']) {
  if (!files.has(required)) throw new Error(`Release archive omits ${required}; correct package.json files before upload`);
}
function entrypoints(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(entrypoints) : [];
}
for (const entry of [...entrypoints(pack.manifest.exports), ...entrypoints(pack.manifest.bin)]) {
  if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) throw new Error(`Published entrypoint is uncompiled: ${entry}`);
  const path = entry.replace(/^\.\//, '');
  if (!path.includes('*') && !files.has(path)) throw new Error(`Release archive omits entrypoint ${entry}`);
}
writeFileSync(join(pack.release, 'pack-inventory.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ package: artifact.name, version: artifact.version, filename: artifact.filename, inventory: join(pack.release, 'pack-inventory.json') }));
