#!/usr/bin/env node
import { hasFlag, optionValue } from '@volter/world-core/args';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createRedisTwinServer } from './server.ts';
const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'serve' || cmd === undefined) {
  const server = await createRedisTwinServer({ port: Number(optionValue(args, '--port', '0')), root: optionValue(args, '--root') || undefined, readOnly: hasFlag(args, '--read-only'), password: optionValue(args, '--password') || undefined });
  process.stdout.write(`redis twin at redis://127.0.0.1:${server.port}; inspect http://127.0.0.1:${server.inspectPort}\n`);
  process.once('SIGTERM', () => { server.stop(); process.exit(0); });
  process.once('SIGINT', () => { server.stop(); process.exit(0); });
  await keepProcessAlive();
} else process.stdout.write('Usage: world-redis serve [--port N] [--root DIR] [--read-only] [--password VALUE]\n');
