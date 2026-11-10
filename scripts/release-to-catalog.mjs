// The release admits itself (README, "Confirm, submit and assess"): after `publish.mjs --confirm-only`, submit the
// confirmed version to the catalog, assess its PR with the catalog's own controller, and fail the release loudly on any
// report but `ready`, closing the PR with that reason. A ready release ends by naming what only the catalog's registered
// assessment authority and its maintainer can do. Never run in CI; it executes no candidate code itself (the catalog's
// controller runs the candidate in its own containers).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';

const catalogRepository = 'volter-ai/twin-catalog-open';
assert.ok(!process.env.GITHUB_ACTIONS, 'Catalog submission and assessment run outside CI');
const cli = process.env.CATALOG_CLI, checkout = process.env.CATALOG_CHECKOUT ? resolve(process.env.CATALOG_CHECKOUT) : '';
assert.ok(cli, 'CATALOG_CLI must name the installed registered catalog CLI');
assert.ok(checkout && existsSync(join(checkout, 'bin/twin-catalog.mjs')), 'CATALOG_CHECKOUT must name a clean twin-catalog-open checkout');
assert.ok(process.env.GH_TOKEN, 'GH_TOKEN must carry the operator\'s existing GitHub sign-in');
const selected = selectedPack();
const publication = JSON.parse(readFileSync(join(selected.release, 'publication.json'), 'utf8'));
assert.equal(publication.registryConfirmed, true, 'Confirm the upload (publish.mjs --confirm-only) before submitting it');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...options });
  assert.equal(result.status, 0, `${command} ${args.slice(0, 2).join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
const git = (...args) => run('git', ['-C', checkout, ...args]).trim();

// 1. the version's one submission, proposed as its own PR (an open PR for the same submission is reused, not doubled)
const submissions = join(selected.release, 'catalog-submissions');
run(process.execPath, ['scripts/prepare-submission.mjs'], { env: { ...process.env, CATALOG_SUBMISSIONS_OUT: submissions } });
const proposed = JSON.parse(run(process.execPath, [cli, 'propose', '--repository', catalogRepository, '--from', submissions, '--send']));
assert.equal(proposed.length, 1, 'One release proposes exactly one submission');
const pr = Number(/\/pull\/(\d+)$/.exec(proposed[0].url)?.[1]);
assert.ok(pr > 0 && proposed[0].state === 'open', `The submission PR is not open: ${proposed[0].url}`);

// 2. its assessment, with the catalog's own controller at the PR's base (the policy and evaluator it is judged by)
const view = JSON.parse(run('gh', ['pr', 'view', String(pr), '--repo', catalogRepository, '--json', 'headRefOid,baseRefOid']));
assert.equal(git('status', '--porcelain'), '', 'The catalog checkout must be clean');
git('fetch', '-q', 'origin', view.baseRefOid);
git('checkout', '-q', '--detach', view.baseRefOid);
const evidence = join(selected.release, `catalog-assessment-${pr}-${view.headRefOid.slice(0, 12)}`);
mkdirSync(evidence, { recursive: true });
const report = join(evidence, 'report.json');
const assessed = spawnSync(process.execPath, ['bin/twin-catalog.mjs', 'assess-pr', '--repository', catalogRepository, '--pr', String(pr), '--out', report],
  { cwd: checkout, stdio: 'inherit', env: process.env });
assert.ok(existsSync(report), `assess-pr wrote no report (exit ${assessed.status}); the release is not admitted`);
const envelope = JSON.parse(readFileSync(report, 'utf8'));
const receipt = { schemaVersion: 1, package: publication.package, version: publication.version, integrity: publication.integrity,
  pullRequest: pr, head: view.headRefOid, base: view.baseRefOid, status: envelope.status, phase: envelope.phase ?? null,
  report: report, reportSha256: createHash('sha256').update(readFileSync(report)).digest('hex'), assessedAt: envelope.evaluatedAt ?? null };
writeFileSync(join(selected.release, 'catalog-assessment.json'), JSON.stringify(receipt, null, 2) + '\n');

// 3. a refusal fails the release, naming why, and leaves no submission open
if (envelope.status !== 'ready') {
  const why = `Assessment ${envelope.status} in phase ${envelope.phase ?? '(none)'}: ${String(envelope.error ?? 'no error recorded').slice(0, 1500)}`;
  run('gh', ['pr', 'close', String(pr), '--repo', catalogRepository, '--comment',
    `The release of ${publication.package}@${publication.version} failed its catalog assessment, so this submission is closed. ${why}\n\nThe npm version stays published and unadmitted; its fix is a new version.`]);
  console.error(`release refused by the catalog: ${publication.package}@${publication.version}, PR #${pr} closed. ${why}`);
  process.exit(1);
}
console.log(JSON.stringify({ ...receipt, remaining: [
  `the catalog's assessment authority records it: node bin/twin-catalog.mjs record-assessment --repository ${catalogRepository} --report <this report> --send`,
  `a separately authorized catalog maintainer merges #${pr}`,
] }, null, 2));
