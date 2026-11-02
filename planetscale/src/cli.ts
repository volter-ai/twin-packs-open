#!/usr/bin/env node
// world-planetscale: serve the planetscale twin.
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createPlanetscaleTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const wirePort = Number(optionValue(rest, '--wire-port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');
// the World's managed Postgres, which the runtime binds a pack declaring managedDatabase to
const database = optionValue(rest, '--database') || undefined;

if (cmd === 'serve' || cmd === undefined) {
  const s = await createPlanetscaleTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(wirePort ? { wirePort } : {}), ...(database ? { database } : {}) });
  process.stdout.write(`planetscale twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  process.stdout.write(`planetscale twin MySQL wire at mysql://127.0.0.1:${s.wirePort}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-planetscale serve [--port N] [--wire-port N] [--root DIR] [--read-only] [--database URL]\n');
}
