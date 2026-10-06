import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2];
if (!['build', 'assess'].includes(mode ?? '')) throw new Error('choose build or assess');
// Locked SDK fixtures are dependency preparation, before entering the credential-free assessment World.
if (mode === 'assess') {
  const standardRoot = resolve('node_modules/@volter/twin-standard');
  const standard = JSON.parse(readFileSync(join(standardRoot, 'package.json'), 'utf8'));
  for (const folder of standard.assessmentClientSdks ?? []) {
    const directory = resolve(standardRoot, folder);
    if (relative(standardRoot, directory).startsWith('..')) throw new Error('SDK fixture directory leaves the installed standard');
    const installed = spawnSync(process.execPath, ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' });
    if (installed.status !== 0) throw new Error('Locked SDK fixture install failed');
  }
}

const work = mkdtempSync(join(tmpdir(), 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode + '-'));
const config = join(work, 'world.json');
writeFileSync(config, JSON.stringify({ id: 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, services: [], network: { egress: [] } }));
const result = spawnSync(process.execPath, [join(process.cwd(), 'node_modules/@volter/world-runtime/src/cli.ts'), 'run', config, '--root', work, '--env-out', join(work, 'world.env'), '--owner', 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, '--', process.execPath, 'scripts/' + mode + '.ts', ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
