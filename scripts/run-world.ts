import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2];
if (!['build', 'assess'].includes(mode ?? '')) throw new Error('choose build or assess');
let runtimeRoot = process.cwd();
let preparedPath: string | undefined;
// Install the packed artifact and locked SDK fixtures before entering the assessment World.
if (mode === 'assess') {
  const prepared = spawnSync('node', ['scripts/prepare-assessment.mjs', process.execPath], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (prepared.status !== 0) throw new Error(prepared.stdout || 'Packed artifact preparation failed; see the preparation diagnostics above');
  const input = JSON.parse(prepared.stdout);
  runtimeRoot = input.work;
  preparedPath = join(input.release, 'prepared-assessment.json');
}

const work = mkdtempSync(join(tmpdir(), 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode + '-'));
const config = join(work, 'world.json');
writeFileSync(config, JSON.stringify({ id: 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, services: [], network: { egress: [] } }));
const result = spawnSync(process.execPath, [join(runtimeRoot, 'node_modules/@volter/world-runtime/src/cli.ts'), 'run', config, '--root', work, '--env-out', join(work, 'world.env'), '--owner', 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, '--', process.execPath, resolve('scripts/' + mode + '.ts'), ...(preparedPath ? [preparedPath] : []), ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
