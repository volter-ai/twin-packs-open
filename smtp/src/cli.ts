#!/usr/bin/env node
// world-smtp: serve the relay (its SMTP listener and its policy port).
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createSmtpTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const policyPort = Number(optionValue(rest, '--policy-port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');

if (cmd === 'serve' || cmd === undefined) {
  const s = await createSmtpTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(policyPort ? { policyPort } : {}) });
  process.stdout.write(`smtp twin${readOnly ? ' [read-only]' : ''} listening on smtp://127.0.0.1:${s.port}\n`);
  process.stdout.write(`smtp twin policy at http://127.0.0.1:${s.policyPort}/_twin/relay\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-smtp serve [--port N] [--policy-port N] [--root DIR] [--read-only]\n');
}
