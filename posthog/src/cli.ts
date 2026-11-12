#!/usr/bin/env node
// world-posthog: serve the posthog twin.
import { parseArgs } from 'node:util';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createPosthogTwinServer } from './server.ts';

const { values, positionals } = parseArgs({ options: { port: { type: 'string' }, root: { type: 'string' }, 'read-only': { type: 'boolean' }, database: { type: 'string' } }, allowPositionals: true, strict: true });
if (positionals.length > 1) throw new Error('Expected one command');
const [cmd] = positionals;
const port = Number(values.port ?? '0') || undefined;
const root = values.root;
const readOnly = Boolean(values['read-only']);
// the selected twin's private Postgres, which the runtime binds a pack declaring managedDatabase to
const database = values.database;

if (cmd === 'serve' || cmd === undefined) {
  const s = await createPosthogTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(database ? { database } : {}) });
  process.stdout.write(`posthog twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-posthog serve [--port N] [--root DIR] [--read-only] [--database URL]\n');
}
