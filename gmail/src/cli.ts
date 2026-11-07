#!/usr/bin/env node
// world-gmail: serve the gmail twin (its webmail, and its receiving SMTP server on the side port the World allocates).
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createGmailTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const smtpPort = Number(optionValue(rest, '--smtp-port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');

if (cmd === 'serve' || cmd === undefined) {
  const s = await createGmailTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(smtpPort ? { smtpPort } : {}) });
  process.stdout.write(`gmail twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  process.stdout.write(`gmail twin receiving mail on smtp://127.0.0.1:${s.smtpPort}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-gmail serve [--port N] [--smtp-port N] [--root DIR] [--read-only]\n');
}
