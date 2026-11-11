#!/usr/bin/env node
// The only way a pack enters this publisher: its directory replaced wholesale by twin-packs-p3's at a commit on p3's
// main, read from git (never a working tree), then given this publisher's package shape and its release's version, the
// lock regenerated, and one commit recording where it came from (`Exported-From: twin-packs-p3@<sha>`).
//
//   node scripts/export-from-p3.mjs --p3 <twin-packs-p3 checkout> --commit <sha on p3 main> <vendor> [<vendor>…]
//
// Run from this repository's root with a clean tree. A vendor whose directory here holds content p3's history never held,
// which the export would delete or change beyond the package shape, is refused, its files listed, before anything is
// written (README). BUN names the Bun binary when `bun` on PATH is not the declared version (package.json
// packageManager). Nothing is published: preparation and release follow (README).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PUBLISHER = 'https://github.com/volter-ai/twin-packs-open';
const root = process.cwd();
const fail = (message) => { console.error(`export-from-p3: ${message}`); process.exit(1); };
const git = (args, cwd = root, input) => execFileSync('git', args, { cwd, encoding: 'utf8', ...(input === undefined ? {} : { input }), stdio: ['pipe', 'pipe', 'pipe'] }).trim();

// arguments
const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); if (at < 0 || !args[at + 1]) return undefined; const v = args[at + 1]; args.splice(at, 2); return v; };
const p3 = option('--p3');
const commitArg = option('--commit');
const vendors = args;
if (!p3 || !commitArg || vendors.length === 0) fail('usage: node scripts/export-from-p3.mjs --p3 <twin-packs-p3 checkout> --commit <sha on p3 main> <vendor> [<vendor>…]');
for (const vendor of vendors) if (!/^[a-z][a-z0-9-]*$/.test(vendor)) fail(`"${vendor}" is no vendor directory name`);
if (!existsSync(join(root, 'scripts', 'export-from-p3.mjs')) || !existsSync(join(root, 'bun.lock'))) fail('run it from twin-packs-open\'s root');

// refusal: a dirty publisher tree, by its paths
const dirty = git(['status', '--porcelain']);
if (dirty) fail(`twin-packs-open's tree is not clean, so an export would mix with other changes:\n${dirty}`);

// refusal: a commit not on p3's main, by name
const p3Root = resolve(p3);
try { git(['fetch', '-q', 'origin', 'main'], p3Root); } catch (error) { fail(`could not fetch twin-packs-p3's main in ${p3Root}: ${error.message}`); }
let sha;
try { sha = git(['rev-parse', '--verify', `${commitArg}^{commit}`], p3Root); } catch { fail(`${commitArg} is no commit in ${p3Root}`); }
if (spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: p3Root }).status !== 0) fail(`${sha} is not on twin-packs-p3's main (origin/main in ${p3Root})`);

// the release's version: the one after the version npm holds, or the pack's own where npm holds none (RECIPE, Catalog admission)
function releaseVersion(name, own) {
  const r = spawnSync('npm', ['view', name, 'version'], { cwd: tmpdir(), encoding: 'utf8' });
  if (r.status !== 0) {
    if (/E404|404 Not Found/.test(r.stderr ?? '')) return own;
    fail(`npm could not be read for ${name}: ${(r.stderr ?? '').trim().split('\n').pop()}`);
  }
  const held = r.stdout.trim();
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(held);
  if (!m) fail(`npm holds ${name}@${held}, which is no plain release version`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

// the publisher's package shape: built entry points, dist and generated shipped, this repository's addresses, no pnpm pins
const built = (path) => path.replace(/^(\.\/)?src\/(.+)\.tsx?$/, './dist/src/$2.js');
function publisherShape(pkg, vendor) {
  const out = { ...pkg };
  if (typeof out.exports === 'string') out.exports = built(out.exports);
  else if (out.exports && typeof out.exports === 'object') out.exports = Object.fromEntries(Object.entries(out.exports).map(([k, v]) => [k, typeof v === 'string' ? built(v) : v]));
  if (typeof out.bin === 'string') out.bin = built(out.bin);
  else if (out.bin && typeof out.bin === 'object') out.bin = Object.fromEntries(Object.entries(out.bin).map(([k, v]) => [k, built(v)]));
  const files = Array.isArray(out.files) ? [...out.files] : [];
  for (const entry of ['LICENSE', 'dist', 'generated']) if (!files.includes(entry)) files.push(entry);
  out.files = files;
  out.repository = { type: 'git', url: `git+${PUBLISHER}.git`, directory: vendor };
  out.homepage = `${PUBLISHER}/tree/main/${vendor}#readme`;
  delete out.packageManager;
  delete out.devEngines;
  delete out.bugs;
  out.bugs = { url: `${PUBLISHER}/issues` };
  return out;
}

// refusal: publisher-only content. The export deletes and rewrites <vendor>/ wholesale. A tracked file here that p3 at
// the commit lacks or holds with other bytes is fine when p3 held exactly these bytes at that path somewhere in the
// commit's history: p3 is newer there, and the export rightly replaces or removes it. A file p3's history never held,
// at that path with those bytes, is publisher-only content, and its vendor is refused before anything is written, its
// files listed; it is resolved into p3 first (p3 is the line), after which the vendor passes. package.json counts as
// held when it equals one of the path's p3 versions in the publisher shape (the version set aside), and README.md when it
// equals one but for the package's install pins: the shape and the pins are what the export itself writes. Only tracked
// files count (the tree is clean): dist/ and node_modules are build output, not content held here.
const trackedBlobs = (cwd, rev, dir) => {
  const out = new Map();
  for (const entry of git(['ls-tree', '-r', '-z', rev, '--', `${dir}/`], cwd).split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [, type, blob] = entry.slice(0, tab).split(' ');
    if (type === 'blob') out.set(entry.slice(tab + 1), blob);
  }
  return out;
};
// every blob each path under <dir>/ has held in the history of rev (the trees only: a blob:none clone fetches nothing)
const historyBlobs = (cwd, rev, dir) => {
  const out = new Map();
  const tokens = execFileSync('git', ['log', '--format=', '--raw', '-z', '--no-abbrev', '--no-renames', rev, '--', `${dir}/`], { cwd, encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const meta = tokens[i].replace(/^\s+/, '');
    if (!meta.startsWith(':')) continue;
    const path = tokens[++i];
    const [, , before, after] = meta.slice(1).split(' ');
    const held = out.get(path) ?? new Set();
    for (const blob of [before, after]) if (!/^0+$/.test(blob)) held.add(blob);
    out.set(path, held);
  }
  return out;
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
const unpinned = (text, name) => text.replace(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}@\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?`, 'g'), `${name}@<release>`);
const refusals = [];
for (const vendor of vendors) {
  try { git(['rev-parse', `${sha}:${vendor}`], p3Root); } catch { fail(`${vendor} is no directory of twin-packs-p3 at ${sha}`); }
  try { git(['cat-file', '-e', `${sha}:${vendor}/package.json`], p3Root); } catch { fail(`${vendor} at ${sha} has no package.json`); }
  const ours = trackedBlobs(root, 'HEAD', vendor);
  if (ours.size === 0) continue; // a vendor new here holds nothing the export could lose
  const theirs = trackedBlobs(p3Root, sha, vendor);
  const history = historyBlobs(p3Root, sha, vendor);
  const p3Blob = (blob) => execFileSync('git', ['cat-file', 'blob', blob], { cwd: p3Root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const ourText = (path) => readFileSync(join(root, path), 'utf8');
  const name = JSON.parse(p3Blob(theirs.get(`${vendor}/package.json`))).name;
  const held = [];
  for (const [path, blob] of ours) {
    if (theirs.get(path) === blob) continue;
    const versions = history.get(path) ?? new Set();
    if (versions.has(blob)) continue; // an older p3 version: p3 is newer
    if (path === `${vendor}/package.json`) {
      const here = JSON.parse(ourText(path));
      const same = (pkg) => JSON.stringify(canonical(publisherShape({ ...pkg, version: here.version }, vendor))) === JSON.stringify(canonical(here));
      if ([...versions].some((v) => same(JSON.parse(p3Blob(v))))) continue;
      const shaped = publisherShape({ ...JSON.parse(p3Blob(theirs.get(path))), version: here.version }, vendor);
      const keys = [...new Set([...Object.keys(here), ...Object.keys(shaped)])].filter((k) => JSON.stringify(canonical(here[k])) !== JSON.stringify(canonical(shaped[k])));
      held.push(`${path} (no p3 version of it in the publisher shape matches; against p3's at the commit: ${keys.join(', ')})`);
      continue;
    }
    if (path === `${vendor}/README.md`) {
      const text = unpinned(ourText(path), name);
      if ([...versions].some((v) => unpinned(p3Blob(v), name) === text)) continue;
    }
    held.push(theirs.has(path) ? `${path} (content p3 never held: the export would change it)` : `${path} (${versions.size ? 'content' : 'a file'} p3 never held: the export would delete it)`);
  }
  if (held.length) refusals.push(`${vendor}: the publisher holds content p3's history at ${sha.slice(0, 8)} never held, which a wholesale export would delete or change; resolve it into p3 first:\n${held.map((h) => `  ${h}`).join('\n')}`);
}
if (refusals.length) fail(`refused, nothing written:\n${refusals.join('\n')}`);

const exported = [];
for (const vendor of vendors) {
  const tree = git(['rev-parse', `${sha}:${vendor}`], p3Root);
  // wholesale: the publisher's directory goes, and p3's at the commit takes its place (git archive, no working tree)
  rmSync(join(root, vendor), { recursive: true, force: true });
  const archive = spawnSync('git', ['archive', '--format=tar', sha, vendor], { cwd: p3Root, maxBuffer: 1 << 30 });
  if (archive.status !== 0) fail(`git archive ${sha} ${vendor} failed: ${archive.stderr.toString().trim()}`);
  const untar = spawnSync('tar', ['-x', '-f', '-', '-C', root], { input: archive.stdout, maxBuffer: 1 << 30 });
  if (untar.status !== 0) fail(`unpacking ${vendor} failed: ${untar.stderr.toString().trim()}`);
  const file = join(root, vendor, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const version = releaseVersion(pkg.name, pkg.version);
  const shaped = publisherShape({ ...pkg, version }, vendor);
  writeFileSync(file, `${JSON.stringify(shaped, null, 2)}\n`);
  // the README's install pins of this package name its release
  const readme = join(root, vendor, 'README.md');
  if (existsSync(readme)) {
    const escaped = pkg.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const text = readFileSync(readme, 'utf8');
    const pinned = text.replace(new RegExp(`${escaped}@\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?`, 'g'), `${pkg.name}@${version}`);
    if (pinned !== text) writeFileSync(readme, pinned);
  }
  exported.push({ vendor, name: pkg.name, version, tree });
}

// the lock, regenerated by the declared Bun (README: lockfile-only, scripts ignored)
const declared = /^bun@(.+)$/.exec(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager ?? '')?.[1];
const bun = process.env.BUN ?? 'bun';
const have = spawnSync(bun, ['--version'], { encoding: 'utf8' }).stdout?.trim();
if (!declared || have !== declared) fail(`the lock is regenerated with Bun ${declared ?? '(undeclared)'}; ${bun} is ${have || 'missing'} (set BUN)`);
const lock = spawnSync(bun, ['install', '--lockfile-only', '--ignore-scripts'], { cwd: root, stdio: 'inherit' });
if (lock.status !== 0) fail('bun install --lockfile-only failed');

// the commit, recording its source
git(['add', '--all', '--', ...vendors, 'bun.lock']);
const subject = `Export ${exported.map((e) => `${e.vendor} ${e.version}`).join(', ')} from twin-packs-p3 ${sha.slice(0, 8)}`;
const body = exported.map((e) => `${e.name}@${e.version}: ${e.vendor}/ replaced wholesale by twin-packs-p3's at ${sha} (tree ${e.tree}), in the publisher's package shape`).join('\n');
const trailers = [`Exported-From: twin-packs-p3@${sha}`, ...exported.map((e) => `Exported-Tree: ${e.vendor} ${e.tree}`)].join('\n');
git(['commit', '-q', '-F', '-'], root, `${subject}\n\n${body}\n\n${trailers}\n`);
console.log(`${subject}\n${git(['rev-parse', 'HEAD'])}`);
