# OpenRouter's API

- **Why this document:** OpenRouter's own OpenAPI document, as it serves it at `https://openrouter.ai/openapi.json`
  (fetched 2026-09-30, vendored gzipped with the example-only substitutions below), the document its SDK (`@openrouter/sdk`, Speakeasy) is generated
  from. Version 1.0.0; 108 paths, 142 operations; server `https://openrouter.ai/api/v1`.
- **SHA-256 of the vendor's bytes** (uncompressed): `a1c912c1a574e55163172f5e77a3adecd87238f65ad9929a7e99a7ff067c4208`.
- **Its pages** (2026-09-30 and 2026-10-01): the API reference overview (the response and finish reasons), streaming (the
  SSE comments and the final usage chunk), errors and debugging, limits (credit and rate limits, `GET /api/v1/key`), OAuth
  PKCE (the `/auth` page and the key exchange) and the Claude Code integration (the Anthropic Messages surface at
  `https://openrouter.ai/api`); and the model pages of the twin's catalogue (`openai/gpt-4o`, `z-ai/glm-5.2`,
  `anthropic/claude-opus-4.8`: each one's price, context, completion limit, input modalities and release date).
  Every page cited is recorded in `sources.json`.
- **Schema corrections:** none. Packaged example-only substitutions are recorded below.
- **Additional sources read 2026-10-01:** the Responses overview (stateless-only storage rules);
  the linked API overview, OAuth, streaming, limits, error and Claude Code pages, whose request examples and rules are
  transcribed in `doc-examples.json`; GPT-4, Claude Sonnet 4, GPT-5.2 and o4 Mini model pages (their prices, windows and release dates).
  The current pages' historical latest-model aliases have no dated binding; the examples journey records them explicitly.
- **Read by:** `bun scripts/derive-pack.ts openrouter`.

## Packaged example scalars

The exact-archive keys sweep flags ten published API-key and key-hash example scalars as `generic-api-key`. Only those scalar strings are replaced with explicit inert markers. The public samples are independent of the credentials issued by the twin.

The original captured files remain outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/openrouter/spec/openapi.json.gz`. For each gzip file, its exact uncompressed original is beside it with the `.gz` suffix removed. Every other uncompressed byte stays unchanged; operations, schemas, field names and response assertions are preserved. JSON pointers use RFC 6901 and are relative to the uncompressed file.

| File | Original SHA-256 | Packaged SHA-256 |
| --- | --- | --- |
| `spec/openapi.json.gz (uncompressed)` | `a1c912c1a574e55163172f5e77a3adecd87238f65ad9929a7e99a7ff067c4208` | `c47ee8c6ecdae35bf68d697f827829ca4700f3fa368c36adcecad979eb0fc559` |
| `spec/openapi.json.gz` (compressed) | `0e5acb8348a52aaa13e62e46dfd0272a1508658fd0c91baec8d654efb77835df` | `f659d7754e36a18674fc7a77a0e82846f2c3eb4e3f5551b8b25c0a60f1a2a70a` |

| File and pointer | Packaged value | Reason |
| --- | --- | --- |
| `spec/openapi.json.gz#/components/schemas/CreateBYOKKeyRequest/example/key` | `<example-provider-key>` | Published provider-key example; inert marker. |
| `spec/openapi.json.gz#/components/schemas/KeyAssignment/example/key_hash` | `<example-key-hash>` | Published key-digest example; inert marker. |
| `spec/openapi.json.gz#/components/schemas/ListKeyAssignmentsResponse/example/data/0/key_hash` | `<example-key-hash>` | Published key-digest example; inert marker. |
| `spec/openapi.json.gz#/paths/~1auth~1keys/post/responses/200/content/application~1json/example/key` | `<example-api-key>` | Published API-key response example; inert marker. |
| `spec/openapi.json.gz#/paths/~1auth~1keys/post/responses/200/content/application~1json/schema/example/key` | `<example-api-key>` | Published API-key response example; inert marker. |
| `spec/openapi.json.gz#/paths/~1byok/post/requestBody/content/application~1json/example/key` | `<example-provider-key>` | Published provider-key example; inert marker. |
| `spec/openapi.json.gz#/paths/~1guardrails~1{id}~1assignments~1keys/get/responses/200/content/application~1json/example/data/0/key_hash` | `<example-key-hash>` | Published key-digest example; inert marker. |
| `spec/openapi.json.gz#/paths/~1guardrails~1assignments~1keys/get/responses/200/content/application~1json/example/data/0/key_hash` | `<example-key-hash>` | Published key-digest example; inert marker. |
| `spec/openapi.json.gz#/paths/~1keys/post/responses/201/content/application~1json/example/key` | `<example-api-key>` | Published API-key response example; inert marker. |
| `spec/openapi.json.gz#/paths/~1keys/post/responses/201/content/application~1json/schema/example/key` | `<example-api-key>` | Published API-key response example; inert marker. |
