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

## Emails workspace references

The read-only Emails workspace is authored from Resend's public [manage-emails guide](https://resend.com/docs/dashboard/emails/manage-emails), its published Email Details image, the [List Sent Emails Endpoint](https://resend.com/changelog/list-sent-emails-endpoint) Emails table image, and the [Email Events Timeline](https://resend.com/changelog/email-events-timeline). It lists stored sent emails and opens the same email fields the API returns, with Preview, Plain Text and HTML views. It uses the kernel's stored rows and history; only recorded events appear. Preview uses a browser-native sandbox and blocks external assets. No dashboard login, sending controls, share links, logs or engagement totals are modeled by this screen.

Reference observation dates, retained image hashes and explicit capture limits are recorded in `screen-references.json`.

The detail composition follows the official [transactional-email product page](https://resend.com/products/transactional-emails)
and its [Email Events image](https://resend.com/static/product-pages/screenshot-email-events.webp):
an envelope beside the recipient heading, From/Subject/To in one overview, recorded events as connected
icon nodes, and the content tabs below. The [Emails list image](https://resend.com/static/product-pages/screenshot-emails.webp)
supplies the recipient envelopes and rounded column-header bar. These retained official images were
captured on 2026-10-11 and viewed before this layout was authored on 2026-10-12.
Technical IDs, reply-to, current status and the actual Created timestamp remain available in a native
details disclosure; they do not displace the message overview and preview. The timeline keeps the
kernel history's native order and actual UTC timestamps. Canonical brand icons substitute for the
vendor glyphs. No API/ellipsis actions, Insights, hover-event actions, inferred transitions or sent ages
are added. This layout follow-up is authored source; its earlier screen captures remain a separate cohort.

The vendor document's neutral palette follows the retained official Email Details pixels recorded there; shared layout/type tokens remain unchanged. This is a source-only correction after the original teal candidate, with no new rendering claim.

The fuller navigation rail follows the official [transactional-email product page](https://resend.com/products/transactional-emails)
and its [Emails workspace image](https://resend.com/static/product-pages/screenshot-emails.webp),
read 2026-10-11. Broadcasts, Audiences, Metrics, Domains, Logs, API Keys, Webhooks and Settings
remain disabled labels because their dashboard screens are not implemented here. Canonical
brand icons are authored substitutes for the vendor glyphs; the outer page permits images
only from `brand.volter.ai`. The sandboxed email-content preview keeps its separate policy
blocking external images, scripts and forms. The list still names its actual API `created_at`
timestamp as Created; the reference's Sent ages do not establish a sent-at field or fabricated
activity in this pack. This source change has no rendered-browser receipt.

- **Authored screen reference record:** `screen-references.json`, SHA-256 of the file bytes:
  `ca4308013ec72b11ff3748c28fd04c6f76a912f16da27f36729e2a468b0bf159`.
