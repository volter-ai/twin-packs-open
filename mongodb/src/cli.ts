#!/usr/bin/env node
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createMongodbTwinServer } from './server.ts';
import { commandTimes } from './stream.ts';
const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'serve' || cmd === undefined) {
  const replicaSet = hasFlag(args, '--replica-set') ? optionValue(args, '--replica-set') : undefined;
  if (hasFlag(args, '--replica-set') && !replicaSet) throw new Error('--replica-set needs its declared name');
  const server = await createMongodbTwinServer({ port: Number(optionValue(args, '--port', '0')), root: optionValue(args, '--root') || undefined,
    readOnly: hasFlag(args, '--read-only'), ...(replicaSet !== undefined ? { replicaSet } : {}) });
  process.stdout.write(`mongodb twin at mongodb://127.0.0.1:${server.port}; inspect http://127.0.0.1:${server.inspectPort}\n`);
  const stop = (): void => { for (const line of commandTimes()) process.stdout.write(`${line}\n`); server.stop(); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await keepProcessAlive();
} else process.stdout.write('Usage: world-mongodb serve [--port N] [--root DIR] [--read-only] [--replica-set NAME]\n');
