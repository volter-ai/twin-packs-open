// Final operator preparation after build, pack and qualification. Never run in CI.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';
import { digest, git, integrity, packedManifest, readJson, sourceCommit, sweepCommit, verifyPreparation } from './release-evidence.mjs';

assert.ok(!process.env.GITHUB_ACTIONS, 'Qualification and keys sweep are explicit operator acts outside CI');
assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Keys sweep refuses injected Node loaders');
const selected = selectedPack();
const source = sourceCommit();
const inventory = readJson(join(selected.release, 'pack-inventory.json'));
assert.match(inventory.filename, /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/);
const archive = join(selected.release, inventory.filename);
const bytes = readFileSync(archive);
assert.equal(integrity(bytes), inventory.integrity);
const manifest = packedManifest(bytes);
assert.equal(manifest.name, selected.manifest.name);
assert.equal(manifest.version, selected.manifest.version);
const qualification = readJson(join(selected.release, 'qualification.json'));
assert.equal(qualification.ready, true, 'Exact archive must qualify before preparation');
assert.equal(qualification.sourceCommit, source);
assert.equal(qualification.integrity, inventory.integrity);
const assessment = readJson(join(selected.release, 'prepared-assessment.json'));
assert.equal(assessment.sourceCommit, source);
assert.equal(assessment.integrity, inventory.integrity);
const sweepRoot = resolve(process.env.PACK_SWEEP_ROOT ?? '');
assert.ok(process.env.PACK_SWEEP_ROOT, 'PACK_SWEEP_ROOT must name the pinned supercode sweep checkout on a custody machine');
assert.equal(git('-C', sweepRoot, 'rev-parse', 'HEAD'), sweepCommit, 'Keys sweep tool commit differs from the reviewed pin');
assert.equal(git('-C', sweepRoot, 'status', '--porcelain', '--untracked-files=all'), '', 'Keys sweep checkout must be unedited');
const sweepDirectory = join(selected.release, 'sweep');
mkdirSync(sweepDirectory, { recursive: true });
const sweepArchive = join(sweepDirectory, `${manifest.name.replace('/', '+')}@${manifest.version}.tgz`);
cpSync(archive, sweepArchive);
writeFileSync(join(sweepDirectory, 'packed'), `${selected.vendor}\t${manifest.name}\t${manifest.version}\n`);
const swept = spawnSync(process.execPath, [join(sweepRoot, 'scripts/npm-keys-sweep.mjs'), sweepDirectory], {
  cwd: sweepRoot, stdio: 'inherit', env: { ...process.env, NODE_AUTH_TOKEN: '', NPM_TOKEN: '' },
});
assert.equal(swept.status, 0, 'Exact-archive keys sweep refused preparation');
assert.equal(git('-C', sweepRoot, 'rev-parse', 'HEAD'), sweepCommit, 'Keys sweep source changed during execution');
assert.equal(git('-C', sweepRoot, 'status', '--porcelain', '--untracked-files=all'), '', 'Keys sweep source changed during execution');
assert.equal(digest(readFileSync(archive)), digest(bytes), 'Archive changed during its keys sweep');
assert.equal(digest(readFileSync(sweepArchive)), digest(bytes), 'Swept bytes differ from retained archive');
assert.equal(sourceCommit(), source, 'Publisher source changed during preparation');
writeFileSync(join(selected.release, 'keys-sweep.json'), JSON.stringify({
  schemaVersion: 1, clean: true, toolCommit: sweepCommit, archiveSha256: digest(bytes),
  sourceCommit: source, completedAt: new Date().toISOString(),
  scope: 'Exact archive; pinned gitleaks rules, custody values and @volter/teams/redact token forms',
}, null, 2) + '\n');
cpSync('bun.lock', join(selected.release, 'publisher-bun.lock'));
cpSync('package.json', join(selected.release, 'publisher-package.json'));
const retained = [inventory.filename, 'pack-inventory.json', 'qualification.json', 'prepared-assessment.json',
  'assessment-package-lock.json', 'publisher-bun.lock', 'publisher-package.json', 'keys-sweep.json'];
for (const name of ['consumer-package-lock.json', 'consumer-pnpm-lock.yaml']) if (existsSync(join(selected.release, name))) retained.push(name);
assert.ok(retained.some(name => name.startsWith('consumer-')), 'Prepared customer dependency lock is absent');
const preparation = {
  kind: 'volter.publisher-preparation', schemaVersion: 1, repository: 'volter-ai/twin-packs-open',
  vendor: selected.vendor, package: manifest.name, version: manifest.version, sourceCommit: source,
  archive: inventory.filename, integrity: inventory.integrity, tools: assessment.tools,
  dependencyLockSha512: assessment.dependencyLockSha512, consumerDependencyLockSha512: assessment.consumerDependencyLockSha512,
  preparedAt: new Date().toISOString(),
  files: retained.map(name => { const contents = readFileSync(join(selected.release, name)); return { name, bytes: contents.length, sha256: digest(contents) }; }),
};
const preparationBytes = JSON.stringify(preparation, null, 2) + '\n';
writeFileSync(join(selected.release, 'preparation.json'), preparationBytes);
verifyPreparation(selected.release, digest(preparationBytes), source);
console.log(JSON.stringify({ vendor: selected.vendor, package: manifest.name, version: manifest.version,
  sourceCommit: source, archiveSha256: digest(bytes), preparationSha256: digest(preparationBytes),
  preparation: join(selected.release, 'preparation.json') }, null, 2));
