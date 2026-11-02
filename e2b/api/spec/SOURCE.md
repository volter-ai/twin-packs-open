# e2b api spec — provenance

- **File:** `openapi.yaml.gz`, gzip of E2B's published REST API document (`spec/openapi.yml` of
  https://github.com/e2b-dev/E2B at `5c0f6eb22bdb`, committed 2026-09-18, fetched 2026-09-30), renamed `.yaml`.
  Served at https://api.e2b.app.
- **SHA-256 of the uncompressed document:** `0fb774ca41bfcb6ead853cc277d9672101f568626edc66f8a682a68036de987a`.
- **Corrections:** none.
- **Read by:** `bun scripts/derive-pack.ts e2b/api`.

`doc-examples.json` records the SDK examples translated through the exact HTTP requests in Twenty's pinned client. Pages read on 2026-10-01: https://docs.e2b.dev/quickstart, https://docs.e2b.dev/sandbox/persistence. These pages publish code, not JSON response samples; values determined by setup are asserted by the replay.
