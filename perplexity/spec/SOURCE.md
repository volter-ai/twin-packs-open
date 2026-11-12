# Perplexity's API

- **Why this document:** Perplexity's own OpenAPI document, as its docs serve it at `https://docs.perplexity.ai/openapi.json`
  (fetched 2026-09-30, vendored unchanged). Server `https://api.perplexity.ai`.
- **Corrections** (`patches.json`): chat completions at `/chat/completions`, the path `@ai-sdk/perplexity` posts to, beside
  the document's `/v1/sonar`.
- **Vendored bytes (sha256):** `openapi.json` `e0b92edf13c7596c5f830e7e61a30af2c534b878a7a505953bbd6829382c3981`; `patches.json` `2842265955f5f68730bb16ada96b407c37004a6365fc8a5fcb6b8e304a8c65ff`.

- **Spec version:** Perplexity AI API `1.0.0`. Perplexity serves this document
  directly rather than at a repository commit; the retained 2026-09-30 capture
  and its sha256 pin the bytes. The live URL now answers different bytes,
  which are not substituted for this capture.
- **Read by:** Codex, 2026-10-03.
- **Scope:** No scanned application calls Perplexity. No operation, credential
  issuance or scenario is served; every operation answers the gap. The
  documented legacy chat-path correction remains useful wire provenance
  without bringing either chat operation into scope.
- **Refusal evidence:** The vendored spec's retrieveAgent 404 response
  documents the unknown-resource class and ErrorInfo envelope, requiring only
  message. https://docs.perplexity.ai/api-reference/agent-get publishes that
  envelope. Neither fixes literal unknown-URL words or type/code values.
  https://docs.perplexity.ai/docs/admin/api-key-management documents Bearer
  authentication and Authentication failed;
  https://docs.perplexity.ai/docs/resources/faq documents the 401 class.
