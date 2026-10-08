# stripe spec — provenance

- **File:** `openapi.json.gz`, gzip of Stripe's published OpenAPI document.
- **Upstream:** https://github.com/stripe/openapi, `openapi/spec3.json` on `master`.
- **Spec version:** `2026-09-30.endive` (`info.version`).
- **SHA-256 of the uncompressed document:** `6b4680299e7b7743811c41537e828b0eae363a11cea44441511013b55e52f7ad`.
- **Read by:** `bun scripts/derive-pack.ts stripe`, which writes `../src/generated/surface.gen.json`.

The pack serves this document's version (`SERVED_VERSION` in `src/engine/version.ts`).

- **Published examples:** `fixtures3.json.gz`, gzip of Stripe's `openapi/fixtures3.json` (one sample object per resource,
  the objects Stripe's API reference shows), from commit `0d98342fc985dc7710a44be25e8528dd8e099bc2` (2026-09-23).
  SHA-256 of the uncompressed file: `e6822f7ee6fd71bdde6228537368aafcfb7191109340fe119d9aca27c6e9396d`.
  **Read by:** `bun scripts/vendor-examples.ts stripe`.
- **Published examples from Stripe's pages:** `doc-examples.json`, the requests and rules Stripe's documentation pages
  publish (its testing page's cards, the payment lifecycle's states, each reference page's stated rule), each with its
  page's URL and the page's words for what it does, read with twin-standard's `read-page`. **Read by:**
  `bun scripts/vendor-examples.ts stripe`.

Screen references, read 2026-10-08: [Stripe's hosted-onboarding guide](https://docs.stripe.com/connect/hosted-onboarding), its hosted_onboarding_form.e59ba8300f563e43489953f06127f52c.png image, supplies the two-column layout, progress and sequential form. The image's example platform branding is configurable; this screen retains the Stripe skin. Back/Continue keep local form answers; only the existing final submit changes the connected account. The existing US requirements and refusal behavior remain the contract. No upstream page, image or script is shipped.
