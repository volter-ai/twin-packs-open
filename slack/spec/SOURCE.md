# slack spec — provenance

- **File:** `openapi.json.gz`, gzip of Slack's published Web API spec (Swagger 2.0).
- **Upstream:** https://github.com/slackapi/slack-api-specs, `web-api/slack_web_openapi_v2.json` on `master`.
- **Spec version:** `1.7.0` (`info.version`); base `https://slack.com/api`. Slack no longer maintains
  this document, so it lags the live API; the twin's own methods beyond it are declared in the manifest.
- **SHA-256 of the uncompressed document:** `742a5c977180a829df8767cf57bc417d99b3713583aee83741efb9c08ca731e7`.
- **Corrections:** `patches.json` (RFC 6902, each with its reason), applied before the IR.
- **Read by:** `bun scripts/derive-pack.ts slack`, which writes `../src/generated/surface.gen.json`.
- **File:** `scopes.json`, Slack's permission scopes with the description each has in Slack's scopes reference
  (https://docs.slack.dev/reference/scopes, read 2026-09-25).
- **SHA-256:** `2dc7b30075ee72850ce8de84ac664780eca34ba9f4a6b1113b3e746b2f213b26`.
