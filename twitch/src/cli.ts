#!/usr/bin/env node
// world-twitch: serve the twitch twin.
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createTwitchTwinServer } from './server.ts';

const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const readOnly = hasFlag(rest, '--read-only');
// the World's managed Postgres, which the runtime binds a pack declaring managedDatabase to
const database = optionValue(rest, '--database') || undefined;
// the World's scenario file, for a model vendor's turns
const scenarioPath = optionValue(rest, '--scenario') || undefined;
// the RTMP ingest's side port, which the World allocates (the manifest's sidePorts)
const ingestPort = Number(optionValue(rest, '--ingest-port', '0')) || undefined;

if (cmd === 'serve' || cmd === undefined) {
  const s = await createTwitchTwinServer({ readOnly, ...(root ? { root } : {}), ...(port ? { port } : {}), ...(database ? { database } : {}), ...(scenarioPath ? { scenarioPath } : {}), ...(ingestPort ? { ingestPort } : {}) });
  process.stdout.write(`twitch twin${readOnly ? ' [read-only]' : ''} at http://127.0.0.1:${s.port}\n`);
  process.stdout.write(s.ingestPort ? `twitch twin ingest at rtmp://127.0.0.1:${s.ingestPort}\n` : 'twitch twin: no RTMP ingest\n');
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-twitch serve [--port N] [--root DIR] [--read-only] [--database URL] [--scenario FILE] [--ingest-port N]\n');
}
