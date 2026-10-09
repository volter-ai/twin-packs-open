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

## Emails workspace references

The read-only Emails workspace is authored from Resend's public [manage-emails guide](https://resend.com/docs/dashboard/emails/manage-emails), its published Email Details image, the [List Sent Emails Endpoint](https://resend.com/changelog/list-sent-emails-endpoint) Emails table image, and the [Email Events Timeline](https://resend.com/changelog/email-events-timeline). It lists stored sent emails and opens the same email fields the API returns, with Preview, Plain Text and HTML views. It uses the kernel's stored rows and history; only recorded events appear. Preview uses a browser-native sandbox and blocks external assets. No dashboard login, sending controls, share links, logs or engagement totals are modeled by this screen.
