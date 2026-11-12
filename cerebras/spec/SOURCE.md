# Cerebras's API

- **Why this document:** Cerebras's own OpenAPI document, as its SDK is generated from it (Stainless): the file
  Cerebras/cerebras-cloud-sdk-node's `.stats.yml` names (`cerebras-cloud-5471bd6d…`), fetched 2026-09-30 and vendored
  gzipped and unchanged. Server `https://api.cerebras.ai`; chat completions at `/v1/chat/completions`.
- **Corrections:** none.
- **Vendored bytes (sha256):** `openapi.yaml.gz` `06911a1ca2810b963307b4168194d7a8127bca1de2514f4832646a2690514428`.

- **Upstream URL:** https://storage.googleapis.com/stainless-sdk-openapi-specs/cerebras/cerebras-cloud-5471bd6d34fdddff21977458788b979ce93f6b080e11ff0d35777182b6615baa.yml
  The vendor SDK's `.stats.yml` names this document at commit
  `eb228a80a5a8a61bf0fae561845a15e3b8617a55` of `Cerebras/cerebras-cloud-sdk-node`.
- **Spec version:** Cerebras Cloud API `0.2.0`.
- **Uncompressed upstream bytes (sha256):** `130749c46caf3000582192de027116e2c396b5cdf19d6235259dcbf978381d12`.
  Reading this immutable URL reproduces the vendored document byte for byte.
- **Read by:** Codex, 2026-10-03.
- **Scope:** No scanned application calls Cerebras. No operation, credential
  issuance or scenario is served; every operation answers the gap.
- **Refusal evidence:** https://inference-docs.cerebras.ai/support/error gives
  404 NotFoundError and 401 AuthenticationError; it does not fix literal error
  messages or codes for unknown URLs. The spec's ErrorChunkContent names
  message, type and code; authentication is documented at
  https://inference-docs.cerebras.ai/api-reference/authentication.
