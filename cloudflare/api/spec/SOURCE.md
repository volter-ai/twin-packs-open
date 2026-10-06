# Cloudflare API v4, as Cloudflare publishes it

- **Source:** `openapi.json` of https://github.com/cloudflare/api-schemas at `d8c062ad8098806b401446a302caf428d3876dee`
  (main, read 2026-09-29), gzipped here as `openapi.json.gz`.
- **sha256 of the vendor's bytes:** `cf5e4482a4e5b27522142ac22281957c1509226a09d98377cb1bc71c9ed9daef`
- **Version:** `4.0.0` (the document's `info.version`): 2,273 paths, 3,620 operations.
- **Read by:** `bun <twin-world>/scripts/derive-pack.ts <this lane>`.
- **Corrections:** `patches.json` adds the Workers service and domain routes absent from this schema, with the pinned wrangler 4.143.0 caller as evidence. It also removes the generic DNS response’s unconditional `data` requirement: Cloudflare’s create reference shows ordinary address records with `content` and no structured `data`. The vendor bytes remain unchanged.
- **Read by (reader):** original API author, 2026-09-29; Codex reread, 2026-09-30.

- **Published page requests and stated rules:** `doc-examples.json` records multipart metadata, asset retention and completion-token authorization from the Workers metadata page, replayed by the vendor examples journey.

The version-upload metadata requirement has an assets-only exception: demanded Wrangler 4.137.0 returns metadata alone at wrangler-dist/cli.js:162957-162974 and adds main_module plus its file for code-bearing Workers at 163599-163651. The digest-pinned archive citation in patches.json records that contradiction; retained spec bytes are unchanged.

The Domains PUT request reused the response schema, incorrectly requiring server-owned fields and both zone selectors. The vendor SDK DomainUpdateParams requires hostname/service and makes both zone selectors optional (cloudflare 7.2.0 resources/workers/domains.d.ts:191-213); the request-only patch preserves the response requirements.
