# World Labs spec — provenance

- **File:** `openapi.yaml.gz`, gzip of the World API's published OpenAPI document,
  https://docs.worldlabs.ai/api/reference/openapi.yaml (version 1.0.0, fetched 2026-09-30). Served at
  https://api.worldlabs.ai.
- **SHA-256 of the uncompressed document:** `4a3ed614672e0b640de378db458907865a4e9c05499482f1e2a79fba5977eebe`.
- **Schema corrections:** none. Packaged example-only substitutions are recorded below. The document names no 401; the host answers a request without a key
  `{"message":"No API key found in request","request_id":"<32 hex>"}` and one with a bad key
  `{"message":"Unauthorized","request_id":"<32 hex>"}` (read 2026-09-30).
- **Read:** 2026-10-01; the vendored bytes and the list request/response and security schemas.
- **Pages read:** https://docs.worldlabs.ai/api/reference/worlds/list (request samples and rendered response), https://docs.worldlabs.ai/api/index (Platform key issuance), https://docs.worldlabs.ai/api/errors (error shapes), https://docs.worldlabs.ai/api/rate-limits (its limits cover generation starts, outside this scope). `doc-examples.json` records the served operation's examples from these pages.
- **Evidence limit:** the prior contributor's host observations above have no retained recording. The spec does not define gateway 401 bodies; they are retained as prior observations, not newly verified vendor recordings.

## Packaged example scalars

The exact-archive keys sweep flags one published base64 pagination-cursor sample, repeated in the OpenAPI document, its transcribed example and the vendor-example journey, as `generic-api-key`. This cursor is not an authentication credential. Only its three scalar occurrences are replaced with the same explicit inert marker. The existing empty-account list journey retains its status, filter fields and every response assertion; API-key issuance is unchanged.

The original captured files remain outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/worldlabs/spec/openapi.yaml.gz`, `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/worldlabs/spec/doc-examples.json`, `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/worldlabs/journeys/vendor-examples.json`. For each gzip file, its exact uncompressed original is beside it with the `.gz` suffix removed. Every other uncompressed byte stays unchanged; operations, schemas, field names and response assertions are preserved. JSON pointers use RFC 6901; the YAML pointer names the equivalent document path.

| File | Original SHA-256 | Packaged SHA-256 |
| --- | --- | --- |
| `spec/openapi.yaml.gz (uncompressed)` | `4a3ed614672e0b640de378db458907865a4e9c05499482f1e2a79fba5977eebe` | `732cb3b2d65c28b01498a36dc34e4999aefcec214c79c61d7ef37194c0c36f76` |
| `spec/openapi.yaml.gz` (compressed) | `4c07f449ee6df77735c95eae19b6d89c6bac4eebc0cfd275fc618a7b225e2ae8` | `e29c57b7d28c58580dbdec7ff38b1e2afb224b5f0877282807a5cbbcc1189033` |
| `spec/doc-examples.json` | `7107d5f7d972ec9f8725c310274c42e908f22bf98dc849bfaf3563f8fb1cb2cf` | `4b0f7c50923fb334febe87037c14a23ec4dd689e441954c76c9fab7173b12ad3` |
| `journeys/vendor-examples.json` | `3a658986c76bf268f0f33ae901d1aaa65ca5b194e74fbb36dcf745b9084ec7eb` | `bee69ebc522d3193580e7de278470ba360bf70b76a2fc8b20796d74e1ede52cc` |

| File and pointer | Packaged value | Reason |
| --- | --- | --- |
| `spec/openapi.yaml.gz#/components/schemas/ListWorldsRequest/examples/4/page_token` | `<example-page-token>` | Published opaque pagination-cursor sample, flagged as generic-api-key; inert marker. |
| `spec/doc-examples.json#/4/input/page_token` | `<example-page-token>` | Published opaque pagination-cursor sample, flagged as generic-api-key; inert marker. |
| `journeys/vendor-examples.json#/steps/5/body/page_token` | `<example-page-token>` | Published opaque pagination-cursor sample, flagged as generic-api-key; inert marker. |
