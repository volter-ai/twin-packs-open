// npm and npm's bun are command shims on Windows (npm.cmd, bun.cmd), which a spawn without a shell cannot start. npm is
// run as its own JavaScript entry under this Node, and bun as the executable its shim names, on every platform.
import { spawnSync } from 'node:child_process';
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
