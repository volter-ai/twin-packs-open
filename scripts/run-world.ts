import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2];
if (!['build', 'assess'].includes(mode ?? '')) throw new Error('choose build or assess');
if (process.env.GITHUB_ACTIONS) throw new Error('Build and qualification are explicit operator commands outside CI');
// Preserve tool/World inputs, never a caller's publication or custody environment.
// This is environment isolation, not a claim of a hermetic filesystem/network boundary.
const candidateEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => [
  'PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'PACK_VENDOR', 'PACK_ASSESSMENT_ROOT',
  'VOLTER_WORLD_POSTGRES_BIN', 'VOLTER_WORLD_BACKEND', 'VOLTER_WORLD_MACHINE',
].includes(name)));
const candidateHome = mkdtempSync(join(tmpdir(), 'publisher-credential-free-home-'));
Object.assign(candidateEnv, { HOME: candidateHome, USERPROFILE: candidateHome });
let runtimeRoot = process.cwd();
let preparedPath: string | undefined;
// Install the packed artifact and locked SDK fixtures before entering the assessment World.
if (mode === 'assess') {
  const prepared = spawnSync('node', ['scripts/prepare-assessment.mjs', process.execPath], { env: candidateEnv, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (prepared.status !== 0) throw new Error(prepared.stdout || 'Packed artifact preparation failed; see the preparation diagnostics above');
  const input = JSON.parse(prepared.stdout);
  runtimeRoot = input.work;
  preparedPath = join(input.release, 'prepared-assessment.json');
}

const work = mkdtempSync(join(tmpdir(), 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode + '-'));
const config = join(work, 'world.json');
writeFileSync(config, JSON.stringify({ id: 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, services: [], network: { egress: [] } }));
const result = spawnSync(process.execPath, [join(runtimeRoot, 'node_modules/@volter/world-runtime/src/cli.ts'), 'run', config, '--root', work, '--env-out', join(work, 'world.env'), '--owner', 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, '--', process.execPath, resolve('scripts/' + mode + '.ts'), ...(preparedPath ? [preparedPath] : []), ...process.argv.slice(3)], { env: candidateEnv, stdio: 'inherit' });
process.exit(result.status ?? 1);
