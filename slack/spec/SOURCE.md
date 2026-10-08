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

Authored OAuth consent layout, reference read 2026-10-08: the firsthand installation screenshot in https://orkes.io/blog/automating-slack-greetings-to-community-with-orkes-conductor/ (2024-04-17). https://docs.slack.dev/authentication/installing-with-oauth/ owns the grant and callback behavior. Existing scope codes are shown in expandable permission groups; no optional grant selector or different workspace is fabricated. No vendor image, DOM or scripts are shipped.

Browser entry for an existing member follows Slack's email-confirmation procedure at https://slack.com/help/articles/212681477-Sign-in-to-Slack (read 2026-10-08): email, the code in mail, then a browser session. The twin's existing mail door carries the code; the shared kernel person/session kit owns the cookie. Client bearer tokens remain supported. The challenge identity, cookie name, six-digit format and ten-minute World-time expiry are twin decisions. SSO, passkeys, Apple/Google sign-in and switching multiple workspaces remain outside this screen's scope. No real mail or identity provider is contacted.
