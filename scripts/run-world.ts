import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runOwnedCommand } from './commands.mjs';
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
const workRoot = resolve(process.env.PACK_ASSESSMENT_ROOT ?? tmpdir());
// Keep cancellation handled while disposable trees are removed, after command forwarding has ended.
process.on('SIGTERM', () => { process.exitCode = 143; });
process.on('SIGINT', () => { process.exitCode = 130; });
mkdirSync(workRoot, { recursive: true });
const active = join(workRoot, 'qualification-active');
try { mkdirSync(active); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  throw new Error(`Another vendor owns qualification; inspect ${join(active, 'owner.json')} before resuming`);
}
let session: string | undefined;
let commandFailed = false;
try {
  writeFileSync(join(active, 'owner.json'), JSON.stringify({ pid: process.pid, vendor: process.env.PACK_VENDOR ?? 'tavily', mode }));
  session = mkdtempSync(join(workRoot, 'catalog-qualification-'));
  const candidateHome = join(session, 'home');
  mkdirSync(candidateHome);
  const cache = join(workRoot, 'package-cache');
  Object.assign(candidateEnv, {
    HOME: candidateHome, USERPROFILE: candidateHome, PACK_ASSESSMENT_ROOT: session,
    npm_config_cache: join(cache, 'npm'), PNPM_CONFIG_STORE_DIR: join(cache, 'pnpm'),
  });
  let runtimeRoot = process.cwd();
  let preparedPath: string | undefined;
  // Install the packed artifact and locked SDK fixtures before entering the assessment World.
  if (mode === 'assess') {
    const prepared = await runOwnedCommand('node', ['scripts/prepare-assessment.mjs', process.execPath], { env: candidateEnv, stdio: ['ignore', 'pipe', 'inherit'] });
    if (prepared.error || prepared.status !== 0) throw new Error(prepared.error?.message || prepared.stdout || 'Packed artifact preparation failed; see the preparation diagnostics above');
    const input = JSON.parse(prepared.stdout);
    runtimeRoot = input.work;
    preparedPath = join(input.release, 'prepared-assessment.json');
  }

  const work = join(session, 'world');
  mkdirSync(work);
  const config = join(work, 'world.json');
  writeFileSync(config, JSON.stringify({ id: 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, services: [], network: { egress: [] } }));
  const result = await runOwnedCommand(process.execPath, [join(runtimeRoot, 'node_modules/@volter/world-runtime/src/cli.ts'), 'run', config, '--root', work, '--env-out', join(work, 'world.env'), '--owner', 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode, '--', process.execPath, resolve('scripts/' + mode + '.ts'), ...(preparedPath ? [preparedPath] : []), ...process.argv.slice(3)], { env: candidateEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  commandFailed = true;
  throw error;
} finally {
  // Native Node removes disposable trees and settles each owned path independently.
  try {
    const cleanup = await runOwnedCommand('node', ['-e', `
    const { rmSync } = require('node:fs');
    process.on('SIGTERM', () => { process.exitCode = 143; });
    process.on('SIGINT', () => { process.exitCode = 130; });
    for (const path of process.argv.slice(1)) {
      try { rmSync(path, { recursive: true, force: true }); }
      catch (error) {
        console.error('Qualification cleanup failed at ' + path + ':', error);
        process.exitCode = 1;
      }
    }
  `, ...[session, active].filter((path): path is string => path !== undefined)], { env: candidateEnv, stdio: ['ignore', 'ignore', 'inherit'] });
    if (cleanup.error || cleanup.status !== 0) throw new Error(`Native qualification cleanup failed: ${cleanup.error?.message ?? `node exited ${cleanup.status}`}`, { cause: cleanup.error });
  } catch (error) {
    process.exitCode = 1;
    if (!commandFailed) throw error;
    console.error(error);
  }
}
