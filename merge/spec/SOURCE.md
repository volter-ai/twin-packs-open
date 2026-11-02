# Merge Gateway spec — provenance

- **File:** `openapi.json.gz`, gzip of Merge Gateway's published OpenAPI document ("API Overview" 1.0.0),
  https://docs.merge.dev/openapi/api-overview.json (fetched 2026-09-30), named by https://docs.merge.dev/llms.txt.
  Served at https://api-gateway.merge.dev.
- **SHA-256 of the uncompressed document:** `dd3b9c4f57cfe162b9c4fe75403c6913eae9c4f20d868b3bd36d79046cccc1bf`.
- **Corrections:** the documented native warnings array is added by `patches.json` (details below). The document names no 401; the host answers a request without a key
  `{"error": {"message": "Missing API key. Provide via 'Authorization: Bearer <key>' or 'X-API-Key' header.", "type": "invalid_request_error"}}`
  (read 2026-09-30).
- **Model prices:** Merge's catalogue (`GET /v1/models`) needs a key and its catalogue page is drawn in the browser, so
  the twin's catalogue (`src/semantics/shared.ts`, `MODELS`) is the model Open Autonomy runs by default with the
  per-token prices Open Autonomy measured against Merge's own reported costs on 2026-09-24
  (open-autonomy-org/open-autonomy @ 9a3db9e, `packages/backend/src/pricing.ts`: 4,427 input and 3 output tokens
  reported $6.6555e-5; 17 and 8, $6.55e-7; 11 input, 4,416 cached and 3 output, $1.3563e-5).
  The catalogue also carries `anthropic/claude-haiku-4-5-20251001`, which Volter Editor's Pi calls, at Anthropic's list
  prices (https://platform.claude.com/docs/en/models/haiku-4-5/overview); `zai/glm-5.3-flash`'s 1M context and 128K
  output are Z.ai's (https://docs.z.ai/guides/vlm/glm-5.3-flash).
- **Read by:** `bun scripts/derive-pack.ts merge`.

## Reference pages and examples read for this change

The served operations have no operation-level request/response examples in the vendored OpenAPI document.
`doc-examples.json` records the requests and rules read on these vendor pages (2026-10-01), with their replay or
recorded reason in `journeys/vendor-examples.json`:

- https://docs.merge.dev/merge-gateway/api-overview (pagination cURL and Python, model lookup, and shared fields).
- https://docs.merge.dev/merge-gateway/errors (model, credential, credit and schema refusals).
- https://docs.merge.dev/merge-gateway/streaming (native snapshots, chat chunks and Anthropic events).
- https://docs.merge.dev/merge-gateway/get-started (native cURL and Python quickstart).
- https://docs.merge.dev/merge-gateway/capabilities/tool-calling (native request, result and tool-choice rules).

Read from the pages' `.md` representations. Examples that select unheld model routes are recorded
without substituting their model or fabricating catalogue prices. The existing model-price and capability citations
remain the fixture's evidence.

`patches.json` adds the documented native Response warnings array missing from the published schema, citing
https://docs.merge.dev/merge-gateway/warnings (read 2026-10-01). It leaves the vendor's compressed bytes unchanged.
