#!/usr/bin/env node
// world-smtp: serve the relay (its SMTP listener and its inspect port).
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createSmtpTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const inspectPort = Number(optionValue(rest, '--inspect-port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');

if (cmd === 'serve' || cmd === undefined) {
  const s = await createSmtpTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(inspectPort ? { inspectPort } : {}) });
  process.stdout.write(`smtp twin${readOnly ? ' [read-only]' : ''} listening on smtp://127.0.0.1:${s.port}\n`);
  process.stdout.write(`smtp twin inspect at http://127.0.0.1:${s.inspectPort}/_twin/messages\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-smtp serve [--port N] [--inspect-port N] [--root DIR] [--read-only]\n');
}
