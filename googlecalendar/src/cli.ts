#!/usr/bin/env node
// world-googlecalendar: serve the googlecalendar twin.
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createGooglecalendarTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');
// the selected twin's private Postgres, which the runtime binds a pack declaring managedDatabase to
const database = optionValue(rest, '--database') || undefined;

if (cmd === 'serve' || cmd === undefined) {
  const s = await createGooglecalendarTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(database ? { database } : {}) });
  process.stdout.write(`googlecalendar twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-googlecalendar serve [--port N] [--root DIR] [--read-only] [--database URL]\n');
}
