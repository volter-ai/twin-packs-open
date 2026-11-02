import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const integrity = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 5000 }).trim();
export const sweepCommit = 'e392ca8c4b14530874bb770e574ab01413da45f9';
export const publicationRef = 'refs/heads/publish';
export const publicationWorkflow = `volter-ai/twin-packs-open/.github/workflows/release.yml@${publicationRef}`;

export function sourceCommit() {
  const commit = git('rev-parse', 'HEAD');
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Commit publisher inputs before preparing release evidence');
  if (process.env.GITHUB_SHA) assert.equal(process.env.GITHUB_SHA, commit, 'Selected source differs from GITHUB_SHA');
  return commit;
}

// Read the original archive; no extraction, links or package code is executed.
export function packedManifest(bytes) {
  const tar = gunzipSync(bytes);
  const field = (start, end) => tar.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
  let manifest;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = field(offset, offset + 100);
    if (!name) break;
    const size = Number.parseInt(field(offset + 124, offset + 136).trim() || '0', 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'Invalid packed archive entry');
    const type = field(offset + 156, offset + 157);
    assert.ok(['', '0', '5', 'x', 'g'].includes(type), 'Release archive contains a link or special entry');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'Release archive entry leaves package');
    if (name === 'package/package.json') {
      assert.equal(manifest, undefined, 'Archive repeats package manifest');
      manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(manifest, 'Original archive has no package manifest');
  return manifest;
}

export function verifyPreparation(directory, expectedDigest, expectedSource) {
  const bytes = readFileSync(join(directory, 'preparation.json'));
  assert.match(expectedDigest ?? '', /^[a-f0-9]{64}$/, 'Exact preparation digest is required');
  assert.equal(digest(bytes), expectedDigest, 'Preparation differs from the permitted digest');
  const preparation = JSON.parse(bytes);
  assert.equal(preparation.kind, 'volter.publisher-preparation');
  assert.equal(preparation.schemaVersion, 1);
  assert.equal(preparation.sourceCommit, expectedSource, 'Preparation belongs to another source revision');
  assert.equal(preparation.repository, 'volter-ai/twin-packs-open');
  assert.equal(preparation.publicationRef, publicationRef, 'Preparation must target the dedicated publish branch');
  assert.equal(preparation.publicationWorkflow, publicationWorkflow, 'Preparation must bind the registered publish workflow');
  assert.match(preparation.vendor, /^[a-z][a-z0-9-]*$/);
  assert.ok(Array.isArray(preparation.files) && preparation.files.length > 0);
  for (const required of ['pack-inventory.json', 'qualification.json', 'prepared-assessment.json', 'keys-sweep.json',
    'assessment-package-lock.json', 'publisher-bun.lock', 'publisher-package.json']) {
    assert.ok(preparation.files.some(file => file.name === required), `Preparation omits ${required}`);
  }
  assert.ok(preparation.files.some(file => /^consumer-(package-lock\.json|pnpm-lock\.yaml)$/.test(file.name)), 'Preparation omits its installed consumer lock');
  assert.equal(new Set(preparation.files.map(file => file.name)).size, preparation.files.length, 'Repeated preparation file');
  for (const file of preparation.files) {
    assert.match(file.name, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Preparation file must be a basename');
    const contents = readFileSync(join(directory, file.name));
    assert.equal(contents.length, file.bytes);
    assert.equal(digest(contents), file.sha256, `Prepared file changed: ${file.name}`);
  }
  assert.ok(preparation.files.some(file => file.name === preparation.archive));
  assert.equal(readdirSync(directory).filter(file => file.endsWith('.tgz')).length, 1, 'Release holds exactly one archive');
  const archiveBytes = readFileSync(join(directory, preparation.archive));
  assert.equal(integrity(archiveBytes), preparation.integrity);
  const manifest = packedManifest(archiveBytes);
  assert.equal(manifest.name, preparation.package);
  assert.equal(manifest.version, preparation.version);
  assert.equal(manifest.repository?.url, 'git+https://github.com/volter-ai/twin-packs-open.git');
  assert.equal(manifest.repository?.directory, preparation.vendor);
  const inventory = readJson(join(directory, 'pack-inventory.json'));
  assert.equal(inventory.name, preparation.package);
  assert.equal(inventory.version, preparation.version);
  assert.equal(inventory.filename, preparation.archive);
  assert.equal(inventory.integrity, preparation.integrity);
  const assessment = readJson(join(directory, 'prepared-assessment.json'));
  assert.equal(assessment.sourceCommit, preparation.sourceCommit);
  assert.equal(assessment.integrity, preparation.integrity);
  assert.deepEqual(assessment.tools, preparation.tools);
  const sha512 = bytes => createHash('sha512').update(bytes).digest('hex');
  assert.equal(sha512(readFileSync(join(directory, 'assessment-package-lock.json'))), assessment.dependencyLockSha512);
  assert.equal(preparation.dependencyLockSha512, assessment.dependencyLockSha512);
  const consumerLock = preparation.files.find(file => /^consumer-(package-lock\.json|pnpm-lock\.yaml)$/.test(file.name));
  assert.equal(sha512(readFileSync(join(directory, consumerLock.name))), assessment.consumerDependencyLockSha512);
  assert.equal(preparation.consumerDependencyLockSha512, assessment.consumerDependencyLockSha512);
  const qualification = readJson(join(directory, 'qualification.json'));
  assert.equal(qualification.ready, true, 'Prepared archive did not qualify');
  for (const key of ['package', 'version', 'integrity', 'sourceCommit']) assert.equal(qualification[key], preparation[key]);
  const sweep = readJson(join(directory, 'keys-sweep.json'));
  assert.equal(sweep.clean, true);
  assert.equal(sweep.toolCommit, sweepCommit);
  assert.equal(sweep.archiveSha256, digest(archiveBytes));
  assert.equal(sweep.sourceCommit, preparation.sourceCommit);
  return preparation;
}
