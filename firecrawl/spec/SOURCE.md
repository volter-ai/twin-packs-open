# Firecrawl's API (v2)

- **Why this document:** Firecrawl's own OpenAPI document for its v2 API, as its docs serve it at
  `https://docs.firecrawl.dev/api-reference/v2-openapi.json` (the file `firecrawl/firecrawl-docs` keeps), fetched
  2026-09-30 and vendored gzipped and unchanged. Server `https://api.firecrawl.dev/v2`.
- **Corrections:** none.
- **Vendored bytes (sha256):** `openapi.json.gz` `ffa223c2e896cb3ae071c64a7f0ba4127a587512ca5ad28f9c779cd63a0f78bc`.

- **Version:** Firecrawl API v2, as named by the retained document.
- **Read by:** Codex; the retained bytes, error and authentication references, 2026-10-03.
- **Uncompressed vendor bytes (sha256):** `c2e7fcc946c9dc6f316f2ca1b5f00e35bb5cbf3de6895838337d092a2e4689fe`. The archive hash above pins the checked-in artifact; this hash pins its upstream content.
- **Error and authentication evidence:** https://docs.firecrawl.dev/api-reference/introduction, and Firecrawl server commit `bca56457b0d8371f1bd903d239f487f5186b8079`: `apps/api/src/lib/not-found.ts` and `apps/api/src/controllers/auth.ts` (raw source citations in `sources.json`). The terminal handler supplies the exact unknown-endpoint wire; the introduction gives the 404 class and Bearer form.
