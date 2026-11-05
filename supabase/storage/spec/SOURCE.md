# Supabase Storage spec — provenance

- **File:** `openapi.json`, storage-api's OpenAPI document as Supabase's documentation publishes it (the source of
  https://supabase.com/docs/reference/storage), the pinned vendor source, with packaged public sample changes listed below: OpenAPI 3.0.3, `info.title` "Supabase
  Storage API", `info.version` `0.0.0`, 138,185 original bytes, 108 operations, no operationIds (the IR mints `method_path` slugs).
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

## Packaged public example scalars

`storage/spec/openapi.json` retains the pinned source above with only the string-scalar replacements listed below. Original inputs are retained outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/supabase/storage/spec/openapi.json`. Original uncompressed SHA-256: `bd435bab4b3b2ef87e3e61f2e948092c30db204f881a4d72d4234a032a356311`; packaged uncompressed SHA-256: `662d740035d1ab2ec5ec029fd8958fcc69566428d68034304323a1607b550d89`. Every byte outside the listed JSON string values is unchanged. These public samples are inert; runtime credentials are issued through the existing doors.

| JSON pointer | Packaged value | Reason |
| --- | --- | --- |
| `/components/schemas/def-0/properties/authorization/example` | `Bearer example-signed-token-1` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1object~1sign~1{bucketName}/post/responses/200/content/application~1json/schema/items/properties/signedURL/example` | `/object/sign/avatars/folder/cat.png?token=example-signed-token-2` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1object~1sign~1{bucketName}~1{*}/get/parameters/1/example` | `example-signed-token-3` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1object~1sign~1{bucketName}~1{*}/head/parameters/1/example` | `example-signed-token-3` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1object~1sign~1{bucketName}~1{*}/post/responses/200/content/application~1json/schema/properties/signedURL/example` | `/object/sign/avatars/folder/cat.png?token=example-signed-token-2` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1object~1upload~1sign~1{bucketName}~1{*}/post/responses/200/content/application~1json/schema/properties/url/example` | `/object/sign/upload/avatars/folder/cat.png?token=example-signed-token-2` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1object~1upload~1sign~1{bucketName}~1{*}/put/parameters/0/example` | `example-signed-token-3` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1render~1image~1sign~1{bucketName}~1{*}/get/parameters/0/example` | `example-signed-token-3` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
| `/paths/~1render~1image~1sign~1{bucketName}~1{*}/head/parameters/0/example` | `example-signed-token-3` | Public signed-token sample replaced with an inert token; URL or authorization structure and repeated token equality are retained. |
