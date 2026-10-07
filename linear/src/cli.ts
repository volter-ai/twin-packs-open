#!/usr/bin/env node
// world-linear: serve the linear twin.
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createLinearTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');
// the World's managed Postgres, which the runtime binds a pack declaring managedDatabase to
const database = optionValue(rest, '--database') || undefined;
// the World's scenario file, for a model vendor's turns
const scenarioPath = optionValue(rest, '--scenario') || undefined;

if (cmd === 'serve' || cmd === undefined) {
  const s = await createLinearTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(database ? { database } : {}), ...(scenarioPath ? { scenarioPath } : {}) });
  process.stdout.write(`linear twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-linear serve [--port N] [--root DIR] [--read-only] [--database URL] [--scenario FILE]\n');
}
