# Sentry ingest

- **Why this document:** Sentry publishes no OpenAPI document for its ingestion endpoint (Relay's). This one is written
  from Sentry's SDK developer documentation, getsentry/sentry-docs at `3ec4e139711af82b38a3c2c17261f5f5cdb66dfc`
  (read 2026-09-30): `develop-docs/sdk/foundations/envelopes/index.mdx` (the endpoint, its headers, its authentication
  and its size limits), `envelopes/envelope-items.mdx` (the item types), `transport/authentication.mdx` (the DSN and
  `X-Sentry-Auth`), `transport/index.mdx` (the answer) and `transport/rate-limiting.mdx`.
- **Its one operation:** `POST /api/<project_id>/envelope/`, at the DSN's host (`o<org id>.ingest[.<region>].sentry.io`).
- **Corrections:** none.

- **Vendored document SHA-256** (openapi.json, decompressed bytes where gzipped): `f5f0151cb49d36d435404491c130ecaafd3b520762cb54478565b267d6e78906`.
- **Read by:** Codex contributor.

## Offline derivation

`write-spec.ts` reads the retained reference bytes below and writes `openapi.json` without network access.

- `envelopes.mdx.gz`, decompressed SHA-256: `d3dba9159ea9ca150c551629c9d7eae8514e72f98656afd6f6a79fb2d184a130`.

- `envelope-items.mdx.gz`, decompressed SHA-256: `95fbf84df1c6d2481e72cd20a96574a226d919adf687f4bd908a78fa2cedcf8c`.

- `transport.mdx.gz`, decompressed SHA-256: `5e22a8f52cbfbe39ca85f5202022541be5afae0061f6baac04d77e9aebcbeec8`.

- `authentication.mdx.gz`, decompressed SHA-256: `ed0a7df5e3bbfec47df29a07ba6f3109eba99dbd62270b8e0cd08dd316616816`.

- `compression.mdx.gz`, decompressed SHA-256: `2fdae4a2362ff90931403d1efe96623526823d7ce3ae67ca456d3cbfb2d62223`.

- `rate-limiting.mdx.gz`, decompressed SHA-256: `22b10f68810b813cfef32ba3eadbdb17e05d679e4384ddcd5810bfa3d55c8145`.

`compression.mdx.gz` retains `transport/compression.mdx`, including gzip, deflate, br and zstd.
