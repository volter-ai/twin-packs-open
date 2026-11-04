# World Labs spec — provenance

- **File:** `openapi.yaml.gz`, gzip of the World API's published OpenAPI document,
  https://docs.worldlabs.ai/api/reference/openapi.yaml (version 1.0.0, fetched 2026-09-30). Served at
  https://api.worldlabs.ai.
- **SHA-256 of the uncompressed document:** `4a3ed614672e0b640de378db458907865a4e9c05499482f1e2a79fba5977eebe`.
- **Corrections:** none. The document names no 401; the host answers a request without a key
  `{"message":"No API key found in request","request_id":"<32 hex>"}` and one with a bad key
  `{"message":"Unauthorized","request_id":"<32 hex>"}` (read 2026-09-30).
- **Read:** 2026-10-01; the vendored bytes and the list request/response and security schemas.
- **Pages read:** https://docs.worldlabs.ai/api/reference/worlds/list (request samples and rendered response), https://docs.worldlabs.ai/api/index (Platform key issuance), https://docs.worldlabs.ai/api/errors (error shapes), https://docs.worldlabs.ai/api/rate-limits (its limits cover generation starts, outside this scope). `doc-examples.json` records the served operation's examples from these pages.
- **Evidence limit:** the prior contributor's host observations above have no retained recording. The spec does not define gateway 401 bodies; they are retained as prior observations, not newly verified vendor recordings.
