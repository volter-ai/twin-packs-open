# resend spec — provenance

- **File:** `openapi.json.gz`, gzip of Resend's published OpenAPI document (OpenAPI 3.1.2).
- **Upstream:** https://github.com/resend/resend-openapi, `resend.json` on `main` at commit
  `83c9782f3e14d5c6e5a89c6eb92f872aa0dad64d` (committed 2026-09-25), fetched 2026-09-25.
- **Spec version:** `1.5.1` (`info.version`); server `https://api.resend.com`; 113 operations.
- **SHA-256 of the uncompressed document:** `834cc0af1324a7a01e8cbe7d125297a249233ecb0fd344faf1024acff9139949`.
- **Corrections:** `patches.json` (RFC 6902, each with its reason and evidence), applied before the IR.
- **Read by:** `bun scripts/derive-pack.ts resend`, which writes `../src/generated/`.
- **Published examples:** the spec carries no operation-level examples; Resend's API-reference pages publish one
  request and answer per operation, vendored in `doc-examples.json` (107 examples, each with its page's URL). Left out,
  because the vendored spec has no operation for them: the Inboxes API (22 pages under /docs/api-reference/inboxes/,
  documented by Resend and absent from this spec), the OAuth authorization flow (register, authorize, token, revoke:
  the spec has no operation for them; only `/oauth/grants` is in it, and counted), and Retrieve Segment Metrics (`GET /segments/metrics`).

Credential-shaped values in documentation example outputs are redacted to explicit placeholders. The examples retain their source URLs and identify the redaction; no example key is a World credential.
