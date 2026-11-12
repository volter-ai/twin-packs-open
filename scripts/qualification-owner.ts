import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runOwnedCommand } from './commands.mjs';

type Signal = 'SIGINT' | 'SIGTERM';
type Lifetime = { cancelled?: Signal; retiring: boolean };
type Completion = { type: 'complete'; status: number };
type Qualification = {
  mode: 'build' | 'assess';
  args: string[];
  command: (executable: string, args: string[], options: Pick<SpawnOptions, 'cwd' | 'stdio'>) => ReturnType<typeof runOwnedCommand>;
  world: (runtimeRoot: string, command: string[], cwd: string) => Promise<number>;
};
type Operation = (qualification: Qualification) => Promise<number>;

/** The entry is re-entered in a detached owner before preparation starts. Only that owner
 * creates disposable paths; its IPC descriptor never reaches a tool or World. */
export async function qualify(operation: Operation): Promise<void> {
  const worker = process.argv[2] === '--lifetime-worker';
  const args = process.argv.slice(worker ? 3 : 2);
  if (worker) await ownLifetime(args, operation);
  else process.exitCode = await supervise(args);
}

async function supervise(argv: string[]): Promise<number> {
  let child: ChildProcess | undefined;
  let cancelled: Signal | undefined;
  let failure: Error | undefined;
  let completion: Completion | undefined;
  const send = (message: object) => {
    if (!child?.connected) return;
    child.send(message, error => {
      if (!error) return;
      failure ??= error;
      if (child?.connected) child.disconnect();
    });
  };
  const cancel = (signal: Signal) => { cancelled ??= signal; send({ type: 'cancel', signal }); };
  const onInt = () => cancel('SIGINT'), onTerm = () => cancel('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    child = spawn(process.execPath, [resolve(process.argv[1]!), '--lifetime-worker', ...argv], {
      cwd: process.cwd(), env: process.env, detached: process.platform !== 'win32',
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'], serialization: 'json',
    });
    child.on('error', error => { failure ??= error; });
    child.on('message', message => {
      const reply = message as Completion;
      if (reply?.type === 'complete' && Number.isInteger(reply.status) && reply.status >= 0 && reply.status <= 255) completion = reply;
    });
    child.once('spawn', () => {
      if (cancelled) send({ type: 'cancel', signal: cancelled });
      send({ type: 'start' });
    });
    const closed = await new Promise<{ code: number | null; signal: string | null }>(done => {
      child!.once('close', (code, signal) => done({ code, signal }));
    });
    if (failure) throw failure;
    if (!completion || closed.code !== completion.status) {
      throw new Error(`Qualification lifetime owner exited without a completed retirement decision (${closed.signal ?? closed.code}); retain qualification-active and inspect its owner`);
    }
    return completion.status || (cancelled === 'SIGINT' ? 130 : cancelled ? 143 : 0);
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
}

async function ownLifetime(argv: string[], operation: Operation): Promise<void> {
  if (!process.send) throw new Error('Qualification owner requires its private lifetime channel');
  const lifetime: Lifetime = { retiring: false };
  let started = false;
  const onInt = () => { lifetime.cancelled ??= 'SIGINT'; };
  const onTerm = () => { lifetime.cancelled ??= 'SIGTERM'; };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  const cancel = (signal: Signal) => {
    lifetime.cancelled ??= signal;
    // runOwnedCommand forwards only the operation's cancellation; retirement always settles.
    if (!lifetime.retiring) process.emit(signal);
  };
  await new Promise<void>(done => {
    const finish = async () => {
      let status: number;
      try { status = await operate(argv, lifetime, operation); }
      catch (error) {
        console.error(error);
        status = lifetime.cancelled === 'SIGINT' ? 130 : lifetime.cancelled ? 143 : 1;
      }
      process.exitCode = status;
      if (process.connected) {
        process.send!({ type: 'complete', status } satisfies Completion, () => {
          if (process.connected) process.disconnect();
          done();
        });
      } else done();
    };
    process.on('disconnect', () => {
      cancel('SIGTERM');
      if (!started) { started = true; void finish(); }
    });
    process.on('message', message => {
      const request = message as { type?: string; signal?: Signal };
      if (request?.type === 'cancel' && (request.signal === 'SIGINT' || request.signal === 'SIGTERM')) cancel(request.signal);
      if (request?.type !== 'start' || started) return;
      started = true;
      void finish();
    });
    if (!process.connected) { cancel('SIGTERM'); started = true; void finish(); }
  });
}

function assertContinuing(lifetime: Lifetime): void {
  if (lifetime.cancelled) throw new Error(`Qualification cancelled by ${lifetime.cancelled}`);
}

// Native retirement commands are awaited without a timeout or signal forwarding. Their own
// runtime owns service termination and confirms completion; interrupting that join loses certainty.
async function settledNode(executable: string, argv: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(executable, argv, { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '', failure: Error | undefined;
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', text => { output += text; });
  child.on('error', error => { failure = error; });
  const result = await new Promise<{ code: number | null; signal: string | null }>(done => {
    child.once('close', (code, signal) => done({ code, signal }));
  });
  if (failure) throw failure;
  if (result.code !== 0) throw new Error(`Native qualification ${argv[0] === '-e' ? 'cleanup' : argv.slice(1, 3).join(' ')} failed (${result.signal ?? result.code})`);
  return output;
}

type Claim = { world: string; root: string };
type Inventory = { worlds: Claim[]; warnings: string[] };

/** The installed product CLI (`@volter/world`'s `volter` bin): the one command surface that starts, inventories and
 *  stops a World. */
function productCli(runtimeRoot: string): string {
  const pkg = join(runtimeRoot, 'node_modules/@volter/world');
  const bin = (JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as { bin?: Record<string, string> }).bin?.volter;
  if (!bin) throw new Error('The installed @volter/world names no volter bin');
  return join(pkg, bin);
}

async function retireSession(session: string, world: string, cli: string, env: NodeJS.ProcessEnv): Promise<void> {
  const sessionRoot = realpathSync(session);
  const problems: string[] = [];
  const native = (argv: string[]) => settledNode(process.execPath, [cli, 'world', ...argv], env);
  const inventory = async (): Promise<Inventory> => {
    const report = JSON.parse(await native(['prune', '--json', '--world', world]))?.inventory;
    if (!Array.isArray(report?.worlds) || !Array.isArray(report.warnings)) {
      throw new Error('Installed CLI returned an unknown lifecycle inventory; session retained');
    }
    return report;
  };
  const before = await inventory();
  if (before.warnings.length) problems.push(`Native lifecycle inventory warnings: ${before.warnings.join('; ')}`);
  // The empty private HOME belongs to this session, so every lifecycle it records is this session's; a root outside the
  // session is never ours to stop. The disposable run retires its own World: a claim left here is one it did not.
  for (const claim of before.worlds) {
    try {
      if (typeof claim?.root !== 'string' || typeof claim.world !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(claim.world)) {
        throw new Error('Unrecognized lifecycle identity');
      }
      const root = realpathSync(claim.root);
      const offset = relative(sessionRoot, root);
      if (isAbsolute(offset) || offset.split(sep)[0] === '..') throw new Error(`Lifecycle root is outside the owned session: ${root}`);
      await native(['down', '--world', root, '--branch', claim.world]);
    } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  const after = await inventory();
  if (after.worlds.length || after.warnings.length) {
    problems.push(`Native lifecycle ownership remains after retirement (${after.worlds.length} Worlds, ${after.warnings.length} warnings)`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

async function operate(argv: string[], lifetime: Lifetime, operation: Operation): Promise<number> {
  assertContinuing(lifetime);
  const [mode, ...args] = argv;
  if (mode !== 'build' && mode !== 'assess') throw new Error('choose build or assess');
  if (process.env.GITHUB_ACTIONS) throw new Error('Build and qualification are explicit operator commands outside CI');
  // Preserve tool/World inputs, never a caller's publication or custody environment.
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
  let cli: string | undefined;
  let work: string | undefined;
  let worldMayHaveStarted = false;
  let worldCommandCompleted = false;
  let status = 1;
  try {
    writeFileSync(join(active, 'owner.json'), JSON.stringify({ pid: process.pid, vendor: process.env.PACK_VENDOR ?? 'tavily', mode }));
    session = mkdtempSync(join(workRoot, 'catalog-qualification-'));
    const candidateHome = join(session, 'home');
    mkdirSync(candidateHome);
    const cache = join(workRoot, 'package-cache');
    Object.assign(candidateEnv, {
      HOME: candidateHome, USERPROFILE: candidateHome, PACK_ASSESSMENT_ROOT: session,
      npm_config_cache: join(cache, 'npm'), PNPM_CONFIG_STORE_DIR: join(cache, 'pnpm'),
      PACK_ASSESSMENT_CACHE: join(workRoot, 'assessment-cache-v7'),
    });
    const command: Qualification['command'] = (executable, args, options) => {
      assertContinuing(lifetime);
      return runOwnedCommand(executable, args, { ...options, env: candidateEnv });
    };
    status = await operation({ mode, args, command, world: async (runtimeRoot, consumer, cwd) => {
      assertContinuing(lifetime);
      if (!isAbsolute(runtimeRoot)) throw new Error('Qualification must identify its exact installed runtime before starting a World');
      if (worldMayHaveStarted) throw new Error('Qualification already started its owning World');
      cli = productCli(runtimeRoot);
      work = join(session!, 'world');
      mkdirSync(work);
      const config = join(work, 'world.json');
      const id = 'catalog-publisher-' + (process.env.PACK_VENDOR ?? 'tavily') + '-' + mode;
      writeFileSync(config, JSON.stringify({ id, services: [], network: { egress: [] } }));
      worldMayHaveStarted = true;
      // a disposable run: the CLI boots its own instance, runs the command in it and retires it
      const result = await command(process.execPath, [cli, 'world', 'run', '--ephemeral', '--world', work, '--', ...consumer], { cwd, stdio: 'inherit' });
      worldCommandCompleted = !result.error && Number.isInteger(result.exitCode) && result.signal === null;
      if (result.error) throw result.error;
      return result.status ?? 1;
    } });
  } catch (error) {
    console.error(error);
    status = lifetime.cancelled === 'SIGINT' ? 130 : lifetime.cancelled ? 143 : 1;
  } finally {
    lifetime.retiring = true;
    try {
      if (worldMayHaveStarted) {
        if (!session || !cli || !work) throw new Error('The exact CLI for native retirement is unknown');
        await retireSession(session, work, cli, candidateEnv);
        if (!worldCommandCompleted) throw new Error('World CLI completion was not confirmed; its lifetime worker may still be retiring');
      }
      // Removing active is conditional on successful session removal. No lifecycle record is edited here.
      await settledNode('node', ['-e', `
        const { rmSync } = require('node:fs');
        process.on('SIGTERM', () => {});
        process.on('SIGINT', () => {});
        const [session, active] = process.argv.slice(1);
        if (session) rmSync(session, { recursive: true, force: true });
        rmSync(active, { recursive: true, force: true });
      `, session ?? '', active], candidateEnv);
    } catch (error) {
      console.error(`Qualification retirement incomplete; retain session ${session ?? '(not created)'} and owner ${join(active, 'owner.json')}`, error);
      status = 1;
    }
  }
  return status === 0 && lifetime.cancelled ? lifetime.cancelled === 'SIGINT' ? 130 : 143 : status;
}
