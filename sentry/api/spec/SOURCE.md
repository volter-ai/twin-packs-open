# Sentry's API

- **Why this document:** Sentry's own OpenAPI document for its web API, as it publishes it for its API reference:
  getsentry/sentry-api-schema at `98ec014705fbecf18c2650097e4630afe51ffd85` (2026-09-29), `openapi-derefed.json`,
  vendored gzipped (`openapi.json.gz`); packaged public sample changes are listed below.
- **Servers:** `https://{region}.sentry.io` (us, de); sentry-cli and the applications call `https://sentry.io/api/0/`.
- **Corrections** (`patches.json`, each with its evidence): the chunk upload (`/chunk-upload/`) and artifact bundle assembly
  (`/artifactbundle/assemble/`) that sentry-cli uploads source maps through; and a single project's release paths
  sentry-cli uses; and its previous-release-with-commits lookup during local git fallback. Their evidence is getsentry/sentry at `2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e` and
  getsentry/sentry-cli 2.58.4 and 2.58.5 (the versions the applications lock).

- **Resource normalization:** the five refresh reads reference named copies of their unchanged inline response schemas. The patches cite each operation in the pinned upstream document; no wire field is added or removed.

- **Original upstream document SHA-256** (openapi.json.gz, decompressed bytes where gzipped): `bb07d2bb747b10b31c14722066cd1d11bd0bb76eea8dcfb5f341b4c421c1c1f9`.
- **Read by:** Codex contributor.

## Packaged public example scalars

`api/spec/openapi.json.gz` retains the pinned source above with only the string-scalar replacements listed below. Original inputs are retained outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/sentry/api/spec/openapi.json.gz` and `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/sentry/api/spec/openapi.json`. Original uncompressed SHA-256: `bb07d2bb747b10b31c14722066cd1d11bd0bb76eea8dcfb5f341b4c421c1c1f9`; packaged uncompressed SHA-256: `e39f236da03e6162bc1fcee602a0865b04f7642fd00eb362cb256bd1cfb01d80`. Every byte outside the listed JSON string values is unchanged. These public samples are inert; runtime credentials are issued through the existing doors.

| JSON pointer | Packaged value | Reason |
| --- | --- | --- |
| `/paths/~1api~10~1organizations~1{organization_id_or_slug}~1preprodartifacts~1snapshots~1latest-base~1/get/responses/200/content/application~1json/examples/LatestBaseSnapshot/value/images/0/image_url` | `/api/0/projects/org-slug/my-project/files/images/000000000000/` | Preserves the image key component of the public example URL. |
| `/paths/~1api~10~1organizations~1{organization_id_or_slug}~1preprodartifacts~1snapshots~1latest-base~1/get/responses/200/content/application~1json/examples/LatestBaseSnapshot/value/images/0/key` | `000000000000` | Inert fixed-width image identifier; matching image URL uses the same identifier. |
| `/paths/~1api~10~1organizations~1{organization_id_or_slug}~1preprodartifacts~1snapshots~1{snapshot_id}~1/get/responses/200/content/application~1json/examples/SnapshotWithComparison(Diff)/value/changed/0/head_image/key` | `000000000000` | Inert fixed-width image identifier; matching image URL uses the same identifier. |
| `/paths/~1api~10~1organizations~1{organization_id_or_slug}~1preprodartifacts~1snapshots~1{snapshot_id}~1/get/responses/200/content/application~1json/examples/SnapshotWithoutComparison(Solo)/value/images/0/key` | `000000000000` | Inert fixed-width image identifier; matching image URL uses the same identifier. |
| `/paths/~1api~10~1organizations~1{organization_id_or_slug}~1preprodartifacts~1snapshots~1{snapshot_id}~1images~1{image_identifier}~1/get/responses/200/content/application~1json/examples/ChangedImage/value/head_image/image_url` | `/api/0/projects/org-slug/project-slug/files/images/000000000000/` | Preserves the image key component of the public example URL. |
| `/paths/~1api~10~1organizations~1{organization_id_or_slug}~1preprodartifacts~1snapshots~1{snapshot_id}~1images~1{image_identifier}~1/get/responses/200/content/application~1json/examples/ChangedImage/value/head_image/key` | `000000000000` | Inert fixed-width image identifier; matching image URL uses the same identifier. |
| `/paths/~1api~10~1projects~1{organization_id_or_slug}~1{project_id_or_slug}~1hooks~1/get/responses/200/content/application~1json/example/0/secret` | `0000000000000000000000000000000000000000000000000000000000000000` | Inert fixed-width webhook secret sample, shared across hook read/create/update examples. |
| `/paths/~1api~10~1projects~1{organization_id_or_slug}~1{project_id_or_slug}~1hooks~1/post/responses/201/content/application~1json/example/secret` | `0000000000000000000000000000000000000000000000000000000000000000` | Inert fixed-width webhook secret sample, shared across hook read/create/update examples. |
| `/paths/~1api~10~1projects~1{organization_id_or_slug}~1{project_id_or_slug}~1hooks~1{hook_id}~1/get/responses/200/content/application~1json/example/secret` | `0000000000000000000000000000000000000000000000000000000000000000` | Inert fixed-width webhook secret sample, shared across hook read/create/update examples. |
| `/paths/~1api~10~1projects~1{organization_id_or_slug}~1{project_id_or_slug}~1hooks~1{hook_id}~1/put/responses/200/content/application~1json/example/secret` | `0000000000000000000000000000000000000000000000000000000000000000` | Inert fixed-width webhook secret sample, shared across hook read/create/update examples. |
