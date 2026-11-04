# Sentry's API

- **Why this document:** Sentry's own OpenAPI document for its web API, as it publishes it for its API reference:
  getsentry/sentry-api-schema at `98ec014705fbecf18c2650097e4630afe51ffd85` (2026-09-29), `openapi-derefed.json`,
  vendored gzipped and unchanged (`openapi.json.gz`).
- **Servers:** `https://{region}.sentry.io` (us, de); sentry-cli and the applications call `https://sentry.io/api/0/`.
- **Corrections** (`patches.json`, each with its evidence): the chunk upload (`/chunk-upload/`) and artifact bundle assembly
  (`/artifactbundle/assemble/`) that sentry-cli uploads source maps through; and a single project's release paths
  sentry-cli uses; and its previous-release-with-commits lookup during local git fallback. Their evidence is getsentry/sentry at `2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e` and
  getsentry/sentry-cli 2.58.4 and 2.58.5 (the versions the applications lock).

- **Resource normalization:** the five refresh reads reference named copies of their unchanged inline response schemas. The patches cite each operation in the pinned upstream document; no wire field is added or removed.

- **Vendored document SHA-256** (openapi.json.gz, decompressed bytes where gzipped): `bb07d2bb747b10b31c14722066cd1d11bd0bb76eea8dcfb5f341b4c421c1c1f9`.
- **Read by:** Codex contributor.
