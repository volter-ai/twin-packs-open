# Supabase Management API spec — provenance

- **File:** `openapi.json.gz`, the Management API's OpenAPI document as the API itself serves it, the vendor's bytes
  unchanged and gzipped (`gzip -9 -n`): OpenAPI 3.0.0, `info.title` "Supabase API (v1)", `info.version` `1.0.0`,
  349,176 bytes, 170 operations under `https://api.supabase.com` (its one `servers` entry).
- **Upstream:** https://api.supabase.com/api/v1-json (the "OpenAPI Spec" link of https://supabase.com/docs/reference/api/introduction),
  fetched 2026-09-28 by the supabase-p3 lane.
- **SHA-256 of the vendor's bytes** (uncompressed): `8873c81f0f0465a17032b78e191ac6d2e89ee5b8cb3245700efed60ba3f6da2c`.
- **Corrections:** none (no `patches.json`).
- **Recordings:**
  - `recordings/2026-09-28-unauthenticated.json`: the live API's answers on 2026-09-28 with no token, a token of another
    scheme, or a token Supabase never issued, no Supabase account used: every one 401 `{"message":"Unauthorized"}`,
    before any path is routed (an unknown path answers the same).
  - `recordings/supabase-cli-e2e/`: the Supabase CLI's own end-to-end fixtures — its requests and the live API's answers as
    the CLI recorded them (sanitized by the CLI: `__PROJECT_REF__`, `__UUID__`, `__JWT__`, `__API_KEY__`), copied
    unchanged from https://github.com/supabase/cli/tree/b55d91959c25b54fefb755f051433e03ce4cb342/apps/cli-e2e/fixtures/recorded:
    organizations listed and made, projects made (answered `UNKNOWN`), read (`ACTIVE_HEALTHY`, the database block),
    listed and deleted (and a delete refused, 400 "Project not ready for deletion."), a project's api-keys (the legacy
    pair and a `default` publishable and secret key), and a query run.
- **Published examples:** the spec's schemas carry `example` values (field values, not examples of an operation); the
  reference pages (https://supabase.com/docs/reference/api/<operationId>) render each operation's schema with placeholder
  values (`lorem`), which are not the vendor's answers either. The recordings above are the vendor's answers.
- **Read by:** `bun scripts/derive-pack.ts supabase`, which writes `../src/generated/`.
- **The data plane's documents** are the lanes': Storage in `../storage/spec`, PostgREST in `../rest/spec`.
