#!/usr/bin/env node
// world-clickhouse: serve the clickhouse twin. Original-file I/O happens only at the trusted CLI seam.
import { hasFlag, optionValue } from '@volter/world-core/args';
import * as kernel from '@volter/world-core';
import type { ServerConfiguration } from './semantics/shared.ts';
import { keepProcessAlive } from '@volter/world-core/lifecycle';
import { createClickhouseTwinServer } from './server.ts';
import { readOriginalInputs, type OriginalInputs } from './engine/original-inputs.ts';
const { digest, nodeBuiltin } = kernel;

type OriginalManifest = Omit<OriginalInputs, 'files'> & {
  mounts: Array<{ path: string; target: string }>;
  files: Array<{ target: string; bytes: number; sha256: string }>;
};
function originalInputs(file: string, root: string, expected?: string): OriginalInputs {
  const fs = nodeBuiltin<{
    readFileSync(path: string, encoding: 'utf8'): string; readFileSync(path: string): Uint8Array;
    realpathSync(path: string): string; readdirSync(path: string): string[];
    lstatSync(path: string): { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean; size: number };
    statSync(path: string): { size: number; isDirectory(): boolean; isFile(): boolean };
  }>('node:fs');
  const path = nodeBuiltin<{ sep: string; relative(from: string, to: string): string; isAbsolute(path: string): boolean; join(...paths: string[]): string; resolve(...paths: string[]): string }>('node:path');
  const manifestBytes = fs.readFileSync(file);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as { kind?: unknown };
  if (value.kind === 'volter.managed-original-inputs') {
    if (!expected || !kernel.managedOriginalInputs || typeof kernel.managedOriginalInputs.readSnapshot !== 'function') throw new Error('Managed original inputs require their expected digest and the World carrier reader');
    const sourceRoot = fs.realpathSync(root), rootStat = fs.lstatSync(root), objectRoot = path.join(sourceRoot, 'objects'), objectStat = fs.lstatSync(objectRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !objectStat.isDirectory() || objectStat.isSymbolicLink()
      || fs.realpathSync(file) !== path.join(sourceRoot, 'manifest.json') || fs.lstatSync(file).isSymbolicLink()) throw new Error('Original carrier is not a confined immutable snapshot');
    const snapshot = kernel.managedOriginalInputs.readSnapshot(manifestBytes, expected, (name, size) => {
      const file = path.join(sourceRoot, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== size) throw new Error('Original carrier object differs');
      return fs.readFileSync(file);
    });
    if (snapshot.manifest.family !== 'clickhouse' || fs.readdirSync(sourceRoot).sort().join('\0') !== 'manifest.json\0objects'
      || fs.readdirSync(objectRoot).sort().join('\0') !== [...snapshot.objects.keys()].sort().join('\0')) throw new Error('Original carrier closed inventory differs');
    return { kind: 'clickhouse.original-inputs', version: 1, source: { image: snapshot.manifest.source.image, commit: snapshot.manifest.source.commit },
      files: snapshot.manifest.inventory.filter(entry => entry.type === 'file').map(entry => ({ target: entry.target, sha256: entry.sha256!, bytes: snapshot.objects.get(entry.sha256!)! })),
      selfHosts: snapshot.manifest.start.selfHosts, environment: snapshot.manifest.start.environment,
      carrier: { bytes: manifestBytes, sha256: expected, objects: [...snapshot.objects].map(([sha256, bytes]) => ({ sha256, bytes })) } };
  }
  if (expected) throw new Error('Expected managed carrier, not a legacy mounted-root manifest');
  const manifest = value as OriginalManifest;
  if (!Array.isArray(manifest.mounts) || !manifest.mounts.length || !Array.isArray(manifest.files)) throw new Error('Original inputs need mounted roots and their complete file inventory');
  const sourceRoot = fs.realpathSync(root), inventory = new Map(manifest.files.map(entry => [entry.target, entry]));
  if (inventory.size !== manifest.files.length) throw new Error('Duplicate original inventory target');
  const files: OriginalInputs['files'] = [], seen = new Set<string>();
  const confined = (file: string): string => {
    const resolved = fs.realpathSync(file), relative = path.relative(sourceRoot, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Original mount escapes its selected source root');
    return resolved;
  };
  const walk = (source: string, target: string, parents: Set<string>) => {
    if (typeof target !== 'string' || !target.startsWith('/') || target.split('/').slice(1).some(part => !part || part === '.' || part === '..' || /[\0\r\n]/.test(part))) throw new Error('Original mount needs a canonical vendor target');
    const resolved = confined(source), stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      if (parents.has(resolved)) throw new Error('Original mount contains a directory cycle');
      const next = new Set(parents); next.add(resolved);
      for (const entry of fs.readdirSync(resolved).sort()) walk(path.join(resolved, entry), target + '/' + entry, next);
      return;
    }
    if (!stat.isFile()) throw new Error(`Original mount is not a regular file: ${target}`);
    const expected = inventory.get(target);
    if (!expected || seen.has(target) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || stat.size !== expected.bytes || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error(`Original inventory differs at ${target}`);
    const bytes = fs.readFileSync(resolved);
    if (bytes.length !== expected.bytes || digest('sha256', bytes) !== expected.sha256) throw new Error(`Original bytes differ at ${target}`);
    seen.add(target); files.push({ target, bytes, sha256: expected.sha256 });
  };
  for (const mount of manifest.mounts) {
    if (typeof mount.path !== 'string' || !mount.path || path.isAbsolute(mount.path) || mount.path.split(/[\\/]/).includes('..')) throw new Error('Original mount source is relative to its selected image/project root');
    walk(path.resolve(sourceRoot, mount.path), mount.target, new Set());
  }
  if (seen.size !== inventory.size) throw new Error('Original inventory has missing or unmounted files');
  return { kind: manifest.kind, version: manifest.version, source: manifest.source, files, selfHosts: manifest.selfHosts,
    ...(manifest.credentials ? { credentials: manifest.credentials } : {}), ...(manifest.environment ? { environment: manifest.environment } : {}) };
}
const [cmd, ...rest] = process.argv.slice(2);
const port = Number(optionValue(rest, '--port', '0')) || undefined;
const nativePort = Number(optionValue(rest, '--native-port', '0')) || undefined;
const root = optionValue(rest, '--root') || undefined;
const configurationFile = optionValue(rest, '--configuration') || undefined;
const configuration = configurationFile ? JSON.parse(nodeBuiltin<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs').readFileSync(configurationFile, 'utf8')) as ServerConfiguration : undefined;
if (configurationFile && (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) || (configuration.databases !== undefined && (!Array.isArray(configuration.databases) || configuration.databases.some(value => typeof value !== 'string' || !value))))) throw new Error('Invalid ClickHouse operator configuration');
const originalFile = optionValue(rest, '--original-inputs') || undefined;
const originalRoot = optionValue(rest, '--original-root') || undefined;
if (Boolean(originalFile) !== Boolean(originalRoot)) throw new Error('Original inputs require both --original-inputs manifest and --original-root image/project directory');
const originalDigest = optionValue(rest, '--original-inputs-sha256') || undefined;
if (originalDigest && !originalFile) throw new Error('Original-input digest has no carrier manifest');
const original = originalFile ? originalInputs(originalFile, originalRoot!, originalDigest) : undefined;
const readOnly = hasFlag(rest, '--read-only');
const database = optionValue(rest, '--database') || undefined;

if (cmd === 'read-original-inputs') {
  if (!original) throw new Error('No original inputs supplied');
  const { configuration: _configuration, queries, ...reading } = await readOriginalInputs(original);
  // No passwords, source contents or bootstrap SQL are printed by the reading command.
  process.stdout.write(JSON.stringify({ ...reading, queries: queries.map(({ file, line }) => ({ file, line })) }, null, 2) + '\n');
  if (!reading.complete) process.exitCode = 1;
} else if (cmd === 'serve' || cmd === undefined) {
  const s = await createClickhouseTwinServer({ readOnly, ...(database ? { database } : {}), ...(configuration ? { configuration } : {}), ...(original ? { originalInputs: original } : {}), ...(root ? { root } : {}), ...(port ? { port } : {}), ...(nativePort ? { nativePort } : {}) });
  process.stdout.write(`clickhouse twin${readOnly ? ' [read-only]' : ''} HTTP http://127.0.0.1:${s.port}, native tcp://127.0.0.1:${s.nativePort}\n`);
  await keepProcessAlive();
} else {
  process.stdout.write('Usage: world-clickhouse serve [--port N] [--native-port N] [--root DIR] [--read-only] [--database URL] [--configuration FILE] [--original-inputs FILE --original-root DIR --original-inputs-sha256 SHA256]\n');
}
