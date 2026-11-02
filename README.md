# Independent twin publisher

This repository publishes immutable Protocol 3 packages using released World and twin-standard tooling. It does not clone platform source or require a platform account. Package-specific behavior, spec, limitations and journeys live with each package. Catalog release claims come from the [catalog process](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/process.md); local standing and publisher qualification are development and preparation records, not admission.

## Prepare outside CI

Main integrates reviewed source and never publishes. Build and qualify explicitly after construction is complete. Use the committed Bun 1.4.2 lock and existing credentials; all candidate execution goes through a task-owned World. Select the vendor directory with `PACK_VENDOR` (the retained default is Tavily).

```sh
bun install --frozen-lockfile --ignore-scripts
export PACK_VENDOR=polar
bun scripts/run-world.ts build
node scripts/pack.mjs
bun scripts/run-world.ts assess
```

Commit the release's version and README installation pins before preparation. The pack command binds its own package tokens in installation commands to the manifest version; other dependencies, historical prose and example pins keep their authored versions. A changed tracked README must be committed and the archive recreated. Qualification refuses a dirty publisher source and records its exact public commit. It installs the archive without lifecycle scripts or workspace links, retains the evaluator and consumer dependency locks and the standard's SDK fixture locks, and uses the released cohort in the root manifest. A candidate does not receive publication credentials. An interrupted assessment retains `qualification.json` with `ready: false`; missing results are never passes.

After qualification, prepare on a POSIX machine holding the existing custody registry. `PACK_SWEEP_ROOT` names an unedited supercode checkout at `e392ca8c4b14530874bb770e574ab01413da45f9`, containing its sweep and `sdk/volter-teams` redactor. The pinned sweep opens compressed entries and checks the exact archive against pinned gitleaks rules, readable custody values and Teams token forms. It refuses unsupported tooling or absent custody instead of issuing a clean verdict.

```sh
PACK_SWEEP_ROOT=/path/to/pinned-supercode node scripts/prepare-release.mjs
```

This produces `release/<vendor>/preparation.json` only after the exact-archive sweep passes. Its digest binds source, package/version/integrity, archive inventory, qualification, released tool selection, publisher lock, both installed dependency locks and the registered publication workflow on `refs/heads/publish`. Any changed retained byte invalidates preparation. Retain the printed source commit, archive SHA-256 and preparation SHA-256 for independent review and the manager's npm release permission. The sweep contains no custody values in its public receipt.

## Publish the reviewed archive

Every publication uses the dedicated `publish` branch. An npm release requires independent review, the clean exact-archive sweep and the manager's permission naming the exact artifacts and preparation digest. Only after that permission, advance `publish` to the reviewed preparation's exact source commit, record the preparation and dispatch the registered provenance workflow. Main integration never advances `publish` or triggers publication. The recording command refuses until the remote `publish` branch points to the prepared source; it never advances a branch, builds or executes candidate code. It creates one public prerelease per vendor/version, tagged `prepared-<vendor>-<version>`, retaining the exact archive and preparation files at that commit. That stable tag retains upload intent across later preparations of the same immutable version; an existing release is inspected, never replaced or bypassed with a new preparation digest. The tag is storage; the workflow executes from `publish`. A release to a website aimed explicitly at the public requires the owner's word.

```sh
export PACK_MANAGER_AUTHORIZATION='<manager release permission reference>'
node scripts/record-release.mjs <permitted-preparation-sha256>
# Run the exact gh workflow command printed by record-release.mjs.
```

`release.yml` is manual, disabled until `PACK_PUBLISH_ENABLED=true`, and runs only from `refs/heads/publish`. It accepts `vendor`, `preparation_tag`, `preparation_sha256` and a `manager_authorization` reference retained for audit; supplying a reference does not grant permission. Its one bounded upload step downloads the retained preparation, verifies every digest and the original archive's manifest, requires the preparation source, selected branch revision and registered workflow revision to agree, and publishes exactly that archive with npm provenance and lifecycle scripts disabled. It installs nothing, builds nothing and runs no qualification, assessment or registry-propagation loop. There are no automatic CI tests or merge gates. The workflow's whole job is bounded to one minute and its single command to 45 seconds; a timeout or cancellation is an unresolved upload, never a successful release.

The workflow keeps its registered `.github/workflows/release.yml` identity. It requires an npm trusted-publishing registration for this public source or its existing scoped `NPM_TOKEN` secret, with OIDC permission for provenance. Preparation recording and workflow dispatch need an existing repository writer's GitHub authentication. Candidate qualification uses neither credential. Publisher registration never grants independent catalog assessment or admission authority.

The upload reads the exact registry version once before publishing. If identical bytes are already present it records that fact without uploading. Different bytes refuse; an unreadable registry is not absence. Before npm is invoked, the workflow retains `upload-started.json` on the preparation release without overwriting an existing marker. A later dispatch seeing that marker refuses another upload even if propagation still answers 404. Workflow reruns only read the exact version and cannot upload. Successful upload acceptance and confirmed registry propagation are separate states; `upload-accepted.json` and the workflow summary retain package, source, integrity, preparation digest, publication branch, workflow revision, run identity and the authorization reference. Repository contents permission is used only for these durable receipts. Keep every run, including failed and timed-out attempts. Never overwrite an immutable npm version or start another publication while an earlier upload's outcome is unresolved.

## Confirm and propose outside CI

Install the exact registered `@volter/twin-catalog` bootstrap version into an operator-owned directory with scripts disabled, retaining its lock. Set `CATALOG_CLI` to that installation's `bin/twin-catalog.mjs`. The catalog's bounded read-only registry policy owns confirmation; propagation waiting stays outside CI.

```sh
PACK_VENDOR=polar node scripts/publish.mjs --confirm-only <permitted-preparation-sha256>
PACK_VENDOR=polar node scripts/prepare-submission.mjs
node "$CATALOG_CLI" propose --repository volter-ai/twin-catalog-open --from release/polar/catalog-submissions --send
```

Confirmation requires the same retained preparation and registry integrity, and writes `publication.json`. Submission preparation requires that confirmation and checks the proposed integrity again. `CATALOG_SUBMISSIONS_OUT` may select another operator-owned output directory. A failed submission or proposal is retried from retained files without another upload. New bytes require a new version, source, qualification and sweep.

Catalog operators assess the immutable registry bytes outside CI using their own registered authority; an authenticated durable assessment receipt and a separately authorized maintainer admission complete the process. A publisher's qualification is not independent evidence. Historical catalog Actions receipts retain their original identities. The catalog owns recommendation, revocation, contributor rules and the released reader; this repository neither approves nor merges a submission.
