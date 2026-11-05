# Supabase Auth (GoTrue, a project's `/auth/v1`) — provenance

- **Spec:** `openapi.yaml`, the Auth server's own OpenAPI description, pinned from
  https://raw.githubusercontent.com/supabase/auth/v2.197.0/openapi.yaml (the release the twin reports at `GET /health`).
  It names no operationIds: `scripts/derive-pack.ts` names each by its method and path.
- **Original upstream SHA-256:** `2e2a74a7459f377dd37e1c0e4c926e39a5be9e6a140fcf6dc1fd0c3ec8a0e621` (`shasum -a 256 openapi.yaml`, 2026-09-29).
- **Corrections:** `patches.json`, two routes GoTrue's router serves that the document omits (POST /admin/users,
  GET /.well-known/jwks.json), each citing the router at the same release.
- **Evidence for rules:** GoTrue's source at v2.197.0 (https://github.com/supabase/auth/tree/v2.197.0/internal/api) and
  Supabase's Auth guides (https://supabase.com/docs/guides/auth).
- **Read by:** `bun scripts/derive-pack.ts supabase/auth`, which writes `../src/generated/`.

## Packaged public example scalars

The original YAML is retained outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/supabase/auth/spec/openapi.yaml`. Original SHA-256: `2e2a74a7459f377dd37e1c0e4c926e39a5be9e6a140fcf6dc1fd0c3ec8a0e621`; packaged SHA-256: `eb3205d65f98d1de339abe8a4c85266a9f30410567b35bec376dd87a11b3eac3`. Only the two example scalar values below change; every other byte remains unchanged. Runtime credentials are issued through the existing doors.

| YAML pointer | Packaged value | Reason |
| --- | --- | --- |
| `/paths/~1token/post/requestBody/content/application~1json/examples/grant_type=refresh_token/value/refresh_token` | `example-refresh-token` | Public OAuth sample replaced with an inert string. |
| `/paths/~1token/post/requestBody/content/application~1json/examples/grant_type=pkce/value/auth_code` | `example-auth-code` | Public OAuth sample replaced with an inert string. |
