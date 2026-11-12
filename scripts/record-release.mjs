// Credentialed recording only: this command never builds or executes a candidate.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';
import { publicationRef, publicationWorkflow, sourceCommit, verifyPreparation } from './release-evidence.mjs';

assert.ok(!process.env.GITHUB_ACTIONS, 'Preparation recording is an explicit operator act outside CI');
const selected = selectedPack();
const digest = process.argv[2];
const preparation = verifyPreparation(selected.release, digest, sourceCommit());
const publishedSource = spawnSync('gh', ['api', `repos/${preparation.repository}/git/ref/heads/publish`, '--jq', '.object.sha'],
  { encoding: 'utf8', timeout: 5000, windowsHide: true });
assert.equal(publishedSource.status, 0, 'Read the remote publish branch before recording preparation');
assert.equal(publishedSource.stdout.trim(), preparation.sourceCommit, 'The publish branch must point to the exact reviewed prepared source');
const managerAuthorization = process.env.PACK_MANAGER_AUTHORIZATION ?? null;
const tag = `prepared-${preparation.vendor}-${preparation.version}`;
const assets = ['preparation.json', ...preparation.files.map(file => file.name)].map(name => join(selected.release, name));
const result = spawnSync('gh', ['release', 'create', tag, ...assets, '--repo', preparation.repository,
  '--target', preparation.sourceCommit, '--prerelease', '--title', `Prepared ${preparation.package}@${preparation.version}`,
  '--notes', `Exact publisher preparation ${digest}. Source ${preparation.sourceCommit}. Publication ref ${publicationRef}. Workflow ${publicationWorkflow}. Manager authorization reference: ${managerAuthorization ?? '(not recorded)'}. This preparation is neither npm publication nor catalog admission.`], { stdio: 'inherit', windowsHide: true });
assert.equal(result.status, 0, 'Preparation recording failed; inspect its release before retrying');
console.log(JSON.stringify({ tag, sourceCommit: preparation.sourceCommit, preparationSha256: digest,
  publicationRef, publicationWorkflow, managerAuthorization,
  next: `gh workflow run release.yml --repo ${preparation.repository} --ref publish -f vendor=${preparation.vendor} -f preparation_tag=${tag} -f preparation_sha256=${digest} -f manager_authorization="$PACK_MANAGER_AUTHORIZATION" -f dist_tag="$PACK_DIST_TAG"` }, null, 2));
