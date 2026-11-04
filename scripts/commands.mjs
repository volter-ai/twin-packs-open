// npm and npm's bun are command shims on Windows (npm.cmd, bun.cmd), which a spawn without a shell cannot start. npm is
// run as its own JavaScript entry under this Node, and bun as the executable its shim names, on every platform.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The program and arguments that run `npm <args>` without a shell. */
export function npmCommand(args) {
  const beside = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = [process.env.npm_execpath, ...beside].find((path) => path && /npm-cli\.js$/.test(path) && existsSync(path));
  return cli ? { command: process.execPath, args: [cli, ...args] } : { command: 'npm', args };
}

/** Bun's own executable: on Windows asked of its shim once, through the shell, with no argument of the caller's. */
export function bunExecutable() {
  if (process.platform !== 'win32') return 'bun';
  const asked = spawnSync('bun', ['-e', '"console.log(process.execPath)"'], { shell: true, encoding: 'utf8', windowsHide: true });
  return asked.status === 0 && asked.stdout.trim() ? asked.stdout.trim() : 'bun';
}

/** A qualification command owns its process group until every writer has ended. */
export async function runOwnedCommand(command, args, options) {
  const { terminationGraceMs, ...spawnOptions } = options;
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, { ...spawnOptions, detached: grouped, windowsHide: true });
  let stdout = '', stderr = '', error, interrupted = 0, cancellation;
  const endGroup = (signal) => {
    if (!child.pid) return;
    if (!grouped) {
      // taskkill follows the install's descendants, including npm's pnpm subprocess.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      return;
    }
    try { process.kill(-child.pid, signal); }
    catch (cause) { if (cause.code !== 'ESRCH') throw cause; }
  };
  const interrupt = (signal) => {
    if (interrupted) return;
    interrupted = signal === 'SIGINT' ? 130 : 143;
    endGroup(signal);
    // Installs have a forced cancellation bound; their supervising steps wait for that cleanup.
    if (terminationGraceMs !== undefined) cancellation = setTimeout(() => endGroup('SIGKILL'), terminationGraceMs);
  };
  const terminate = () => interrupt('SIGTERM'), cancel = () => interrupt('SIGINT');
  process.on('SIGTERM', terminate);
  process.on('SIGINT', cancel);
  const collect = (stream, write) => {
    let size = 0;
    stream?.setEncoding('utf8');
    stream?.on('data', (text) => {
      size += Buffer.byteLength(text);
      if (size <= 32 * 1024 * 1024) write(text);
      else {
        error = new Error('Qualification command output exceeded 32 MiB');
        interrupt('SIGTERM');
      }
    });
  };
  collect(child.stdout, (text) => { stdout += text; });
  collect(child.stderr, (text) => { stderr += text; });
  try {
    const status = await new Promise((resolve) => {
      child.once('error', (cause) => { error = cause; });
      // close waits for inherited pipes too, so end orphan writers as soon as their parent exits.
      child.once('exit', () => { if (grouped) endGroup('SIGKILL'); });
      child.once('close', resolve);
    });
    if (grouped && child.pid) {
      // An exited npm parent is not a finished step while a descendant still writes.
      endGroup('SIGKILL');
      for (;;) {
        try { process.kill(-child.pid, 0); }
        catch (cause) { if (cause.code === 'ESRCH') break; throw cause; }
        await delay(20);
      }
    }
    return { status: interrupted || status, stdout, stderr, error };
  } finally {
    clearTimeout(cancellation);
    process.off('SIGTERM', terminate);
    process.off('SIGINT', cancel);
  }
}
