import { selectedPack } from './selected-pack.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const registry = 'https://registry.npmjs.org';
const selected = selectedPack();
const pkg = selected.manifest;
const files = readdirSync(selected.release).filter((name) => name.endsWith('.tgz'));
if (files.length !== 1) throw new Error('release must contain one immutable package');
const archive = resolve(selected.release, files[0]);
const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
const cli = process.env.CATALOG_CLI;
if (!cli) throw new Error('CATALOG_CLI must name the exact installed bootstrap CLI');
const { metadata } = await import(pathToFileURL(resolve(dirname(cli), '../lib/registry.mjs')).href);
const url = `${registry}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
const lookup = await fetch(url, { redirect: 'error' });
let accepted = false;
if (lookup.status === 404 && !process.argv.includes('--confirm-only') && Number(process.env.GITHUB_RUN_ATTEMPT ?? 1) === 1) {
  const qualification = JSON.parse(readFileSync(join(selected.release, 'qualification.json'), 'utf8'));
  if (qualification.ready !== true || qualification.package !== pkg.name || qualification.version !== pkg.version || qualification.integrity !== integrity) throw new Error('Upload requires qualification of these exact release bytes');
  if (!process.env.GITHUB_SHA || qualification.sourceCommit !== process.env.GITHUB_SHA) throw new Error('Qualification belongs to a different publisher source');
  const result = spawnSync('npm', ['publish', '--ignore-scripts', '--access', 'public', '--provenance', archive], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Upload did not report success; retain diagnostics and inspect registry before retrying');
  accepted = true;
  writeFileSync(join(selected.release, 'upload-accepted.json'), JSON.stringify({ package: pkg.name, version: pkg.version, integrity, sourceCommit: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID }, null, 2) + '\n');
} else if (lookup.status !== 404 && !lookup.ok) {
  throw new Error(`Registry lookup refused: HTTP ${lookup.status}`);
}
// Reuse the released catalog's measured, bounded read-only confirmation policy.
// Workflow reruns and --confirm-only can only confirm; they never upload.
const doc = await metadata(pkg.name, pkg.version, registry, fetch, {});
if (doc.dist?.integrity !== integrity) throw new Error('Registry version has different immutable bytes; do not overwrite');
if (doc.repository?.url !== pkg.repository.url) throw new Error('Registry version has a different source repository');
writeFileSync(join(selected.release, 'publication.json'), JSON.stringify({ package: pkg.name, version: pkg.version, integrity, sourceCommit: process.env.GITHUB_SHA, acceptedUpload: accepted, registryConfirmed: true }, null, 2) + '\n');
