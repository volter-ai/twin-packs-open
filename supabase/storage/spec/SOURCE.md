# Supabase Storage spec — provenance

- **File:** `openapi.json`, storage-api's OpenAPI document as Supabase's documentation publishes it (the source of
  https://supabase.com/docs/reference/storage), the vendor's bytes unchanged: OpenAPI 3.0.3, `info.title` "Supabase
  Storage API", `info.version` `0.0.0`, 138,185 bytes, 108 operations, no operationIds (the IR mints `method_path` slugs).
- **Upstream:** https://raw.githubusercontent.com/supabase/supabase/80761d2521cbaf796ea9e9d84975dc20219e03ef/apps/docs/spec/storage_v0_openapi.json
  (repository `supabase/supabase`, `master` at that commit), fetched 2026-09-28.
- **SHA-256 of the vendor's bytes:** `bd435bab4b3b2ef87e3e61f2e948092c30db204f881a4d72d4234a032a356311`.
- **License:** Apache-2.0 (the `supabase/supabase` repository's LICENSE).
- **Corrections** (`patches.json`): the document gives the bucket collection at `/bucket/` (a GET and a POST) and only
  its HEAD at `/bucket`; storage-js and the Supabase CLI call `/bucket` with no trailing slash, and the CLI's recorded
  exchange with the live service answered it (`recordings/supabase-cli-e2e/POST_storage_v1_bucket--default.*`). The two
  operations move to `/bucket`, their ids unchanged (`get_bucket`, `post_bucket`). The HEAD routes remain at both `/bucket` and `/bucket/`, as the vendor serves them.
- **The ids the IR mints collide** where two paths differ only by the object path `{*}` (`delete_object_bucketname`:
  one object and several; `post_object_sign_bucketname`: one signed URL and several) and where the document repeats a
  path with a trailing slash (`head_health`, the TUS and S3 routes): each pair is one operation of the surface.
- **Recordings** (`recordings/supabase-cli-e2e/`): the Supabase CLI's own end-to-end fixtures, its requests and the live
  service's answers as the CLI recorded them (sanitized: `__UUID__`, `__PROJECT_REF__`, `__JWT__`), copied unchanged from
  https://github.com/supabase/cli/tree/b55d91959c25b54fefb755f051433e03ce4cb342/apps/cli-e2e/fixtures/recorded.
- **The vendor's own source** is cited for what the document does not state (its error body, its exposed HEAD routes):
  storage-api `v1.79.22` (tag commit `61acd3b8ae57c31698b9171f0f2dd77bdb0b4b68`).
- **Read by:** `bun scripts/derive-pack.ts supabase/storage`, which writes `../src/generated/`.
