import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
mkdirSync(workRoot, { recursive: true });
const active = join(workRoot, 'qualification-active');
try { mkdirSync(active); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  throw new Error(`Another vendor owns qualification; inspect ${join(active, 'owner.json')} before resuming`);
}
let session: string | undefined;
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
} finally {
  // Archives, dependency locks and the verdict are retained in release/<vendor>; installs are disposable.
  if (session) rmSync(session, { recursive: true, force: true });
  rmSync(active, { recursive: true });
}
