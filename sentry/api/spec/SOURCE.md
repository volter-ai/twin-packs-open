# Sentry's API

- **Why this document:** Sentry's own OpenAPI document for its web API, as it publishes it for its API reference:
  getsentry/sentry-api-schema at `98ec014705fbecf18c2650097e4630afe51ffd85` (2026-09-29), `openapi-derefed.json`,
  originally captured gzipped and unchanged; the public `openapi.json.gz` now transforms only sample literals as described below.
- **Servers:** `https://{region}.sentry.io` (us, de); sentry-cli and the applications call `https://sentry.io/api/0/`.
- **Corrections** (`patches.json`, each with its evidence): the chunk upload (`/chunk-upload/`) and artifact bundle assembly
  (`/artifactbundle/assemble/`) that sentry-cli uploads source maps through; and a single project's release paths
  sentry-cli uses; and its previous-release-with-commits lookup during local git fallback. Their evidence is getsentry/sentry at `2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e` and
  getsentry/sentry-cli 2.58.4 and 2.58.5 (the versions the applications lock).

- **Resource normalization:** the five refresh reads reference named copies of their unchanged inline response schemas. The patches cite each operation in the pinned upstream document; no wire field is added or removed.

- **Original upstream captured document SHA-256** (decompressed bytes): `bb07d2bb747b10b31c14722066cd1d11bd0bb76eea8dcfb5f341b4c421c1c1f9`.
- **Read by:** Codex contributor.

## Public sample transformation

This public projection replaces snapshot image-key samples and project-hook webhook-secret samples with deterministic low-entropy synthetic values. Matching uses of that identifier in image URLs, span/profile identifiers, commit samples and the customer-life fixture are transformed consistently, retaining hexadecimal identifier formats. These are transformed examples, not live account credentials or verbatim upstream examples. The original private capture and its upstream identity above remain unchanged; schema fields and operation behavior are retained.

- **Original private captured gzip SHA-256:** `0c22ebb6a5b56138eb13f07a8caf84de4ae432b65d6dc6989d24ec74a44092c6`.
- **Public transformed OpenAPI SHA-256, expanded:** `339f455e731138f9cc484e257cb30c0b3229e235aaf444c1ccd35b9e541083f5`.
- **Public transformed OpenAPI SHA-256, gzip:** `42f3d534e3125898d5553ec9c10ff91036caa48b727c907ed2e9cea484c7da39`.
