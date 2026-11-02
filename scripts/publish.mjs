import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';
import { npmCommand } from './commands.mjs';
import { readJson, verifyPreparation } from './release-evidence.mjs';

const registry = 'https://registry.npmjs.org';
const upload = process.argv.includes('--upload-only');
const confirmation = process.argv.includes('--confirm-only');
assert.ok(upload !== confirmation, 'Choose --upload-only in the registered workflow or --confirm-only outside CI');
const vendor = process.env.PACK_VENDOR ?? 'tavily';
assert.match(vendor, /^[a-z][a-z0-9-]*$/);
let directory, preparationDigest, expectedSource;
if (upload) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Uploads require the registered provenance workflow');
  assert.equal(process.env.GITHUB_REPOSITORY, 'volter-ai/twin-packs-open');
  assert.match(process.env.GITHUB_WORKFLOW_REF ?? '', /^volter-ai\/twin-packs-open\/\.github\/workflows\/release\.yml@/);
  assert.match(process.env.PACK_PREPARATION_TAG ?? '', /^prepared-[a-z0-9.-]+-[a-f0-9]{16}$/);
  directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'prepared-pack-'));
  const downloaded = spawnSync('gh', ['release', 'download', process.env.PACK_PREPARATION_TAG,
    '--repo', process.env.GITHUB_REPOSITORY, '--dir', directory], { stdio: 'inherit', timeout: 12000 });
  assert.equal(downloaded.status, 0, 'Prepared archive download failed');
  preparationDigest = process.env.PACK_PREPARATION_SHA256;
  expectedSource = process.env.GITHUB_SHA;
} else {
  assert.ok(!process.env.GITHUB_ACTIONS, 'Registry propagation confirmation runs outside CI');
  directory = selectedPack().release;
  preparationDigest = process.argv[process.argv.indexOf('--confirm-only') + 1];
  expectedSource = readJson(join(directory, 'preparation.json')).sourceCommit;
}
const preparation = verifyPreparation(directory, preparationDigest, expectedSource);
assert.equal(preparation.vendor, vendor);
const archive = resolve(directory, preparation.archive);
const receipt = {
  schemaVersion: 1, package: preparation.package, version: preparation.version, integrity: preparation.integrity,
  sourceCommit: preparation.sourceCommit, preparationSha256: preparationDigest,
  acceptedUpload: false, registryConfirmed: false,
  workflowRun: process.env.GITHUB_RUN_ID ?? null, workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
};
if (upload) {
  // One read, one bounded upload. Unknown registry responses never mean absence.
  const response = await fetch(`${registry}/${encodeURIComponent(preparation.package)}/${encodeURIComponent(preparation.version)}`,
    { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (response.ok) {
    const metadata = await response.json();
    assert.equal(metadata.dist?.integrity, preparation.integrity, 'Registry already holds different immutable bytes; do not overwrite');
    receipt.registryConfirmed = true;
    receipt.alreadyPresent = true;
  } else {
    assert.equal(response.status, 404, `Registry lookup refused: HTTP ${response.status}`);
    assert.equal(Number(process.env.GITHUB_RUN_ATTEMPT), 1, 'A workflow rerun only reads the exact version; never upload again');
    assert.ok(!existsSync(join(directory, 'upload-started.json')), 'An earlier publication started; resolve its exact registry version without another upload');
    assert.ok(!existsSync(join(directory, 'upload-accepted.json')), 'An earlier upload was accepted; confirm it outside CI');
    const publishing = npmCommand(['publish', '--ignore-scripts', '--access', 'public', '--provenance', '--fetch-retries=0', '--fetch-timeout=12000', archive]);
    writeFileSync(join(directory, 'upload-started.json'), JSON.stringify(receipt, null, 2) + '\n');
    const retained = spawnSync('gh', ['release', 'upload', process.env.PACK_PREPARATION_TAG,
      join(directory, 'upload-started.json'), '--repo', process.env.GITHUB_REPOSITORY], { stdio: 'inherit', timeout: 5000 });
    assert.equal(retained.status, 0, 'Could not retain upload intent; no upload attempted');
    const result = spawnSync(publishing.command, publishing.args, { stdio: 'inherit', timeout: 20000 });
    assert.equal(result.status, 0, 'Upload outcome is unresolved; confirm the exact version outside CI before any further publication');
    receipt.acceptedUpload = true;
  }
  writeFileSync(join(directory, 'upload-accepted.json'), JSON.stringify(receipt, null, 2) + '\n');
  const recorded = spawnSync('gh', ['release', 'upload', process.env.PACK_PREPARATION_TAG,
    join(directory, 'upload-accepted.json'), '--repo', process.env.GITHUB_REPOSITORY, '--clobber'], { stdio: 'inherit', timeout: 5000 });
  assert.equal(recorded.status, 0, 'Upload result could not be retained; confirm the exact registry version outside CI');
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\nExact archive upload: \`${preparation.package}@${preparation.version}\`\n\nPreparation SHA-256: \`${preparationDigest}\`\n\nSource: \`${preparation.sourceCommit}\`\n\nIntegrity: \`${preparation.integrity}\`\n\nAccepted upload: ${receipt.acceptedUpload}. Registry bytes already confirmed: ${receipt.registryConfirmed}. Run the operator confirmation and submission commands outside CI.\n`, { flag: 'a' });
} else {
  const cli = process.env.CATALOG_CLI;
  assert.ok(cli, 'CATALOG_CLI must name the exact installed registered catalog bootstrap CLI');
  const { metadata } = await import(pathToFileURL(resolve(dirname(cli), '../lib/registry.mjs')).href);
  const document = await metadata(preparation.package, preparation.version, registry, fetch, {});
  assert.equal(document.dist?.integrity, preparation.integrity, 'Registry version differs from the reviewed archive');
  assert.equal(document.repository?.url, 'git+https://github.com/volter-ai/twin-packs-open.git');
  receipt.registryConfirmed = true;
  receipt.confirmedAt = new Date().toISOString();
  writeFileSync(join(directory, 'publication.json'), JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify(receipt, null, 2));
