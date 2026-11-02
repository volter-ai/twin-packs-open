// Credentialed recording only: this command never builds or executes a candidate.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectedPack } from './selected-pack.mjs';
import { sourceCommit, verifyPreparation } from './release-evidence.mjs';

const selected = selectedPack();
const digest = process.argv[2];
const preparation = verifyPreparation(selected.release, digest, sourceCommit());
const tag = `prepared-${preparation.vendor}-${preparation.version}-${digest.slice(0, 16)}`;
const assets = ['preparation.json', ...preparation.files.map(file => file.name)].map(name => join(selected.release, name));
const result = spawnSync('gh', ['release', 'create', tag, ...assets, '--repo', preparation.repository,
  '--target', preparation.sourceCommit, '--prerelease', '--title', `Prepared ${preparation.package}@${preparation.version}`,
  '--notes', `Exact publisher preparation ${digest}. Source ${preparation.sourceCommit}. This preparation is neither npm publication nor catalog admission.`], { stdio: 'inherit' });
assert.equal(result.status, 0, 'Preparation recording failed; inspect its release before retrying');
console.log(JSON.stringify({ tag, sourceCommit: preparation.sourceCommit, preparationSha256: digest,
  next: `gh workflow run release.yml --repo ${preparation.repository} --ref ${tag} -f vendor=${preparation.vendor} -f preparation_tag=${tag} -f preparation_sha256=${digest}` }, null, 2));
