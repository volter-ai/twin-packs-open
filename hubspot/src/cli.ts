#!/usr/bin/env node
// world-hubspot: serve the hubspot twin.
import { parseArgs } from 'node:util';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createHubspotTwinServer } from './server.ts';

const { values, positionals } = parseArgs({ options: { port: { type: 'string' }, root: { type: 'string' }, 'read-only': { type: 'boolean' }, database: { type: 'string' } }, allowPositionals: true, strict: true });
if (positionals.length > 1) throw new Error('Expected one command');
const [cmd] = positionals;
const port = Number(values.port ?? '0') || undefined;
const root = values.root;
const readOnly = Boolean(values['read-only']);
// the selected twin's private Postgres, which the runtime binds a pack declaring managedDatabase to
const database = values.database;

if (cmd === 'serve' || cmd === undefined) {
  const s = await createHubspotTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(database ? { database } : {}) });
  process.stdout.write(`hubspot twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-hubspot serve [--port N] [--root DIR] [--read-only] [--database URL]\n');
}
