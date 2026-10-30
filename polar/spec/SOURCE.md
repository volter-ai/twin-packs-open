# Polar API spec — provenance

- **File:** `openapi.json.gz`, Polar's own OpenAPI document, the vendor's bytes unchanged and gzipped (`gzip -9 -n`):
  OpenAPI 3.1.0, `info.title` "Polar API", `info.version` `2026-04`, 2,691,391 bytes, 186 operations across 127 paths,
  served at `https://api.polar.sh` (production) and `https://sandbox-api.polar.sh` (sandbox).
- **Upstream:** https://polar.sh/docs/openapi.json, fetched 2026-09-29 (the document Polar's API reference is built
  from; the same URL the retired census fixture was cut from on 2026-09-02).
- **SHA-256 of the vendor's bytes** (uncompressed): `b5fafab90f8de4ef5cd839217229b934b6ff8862614055e6010dc03d5f8d15d7`.
- **Corrections:** none yet (no `patches.json`).
- **Read by:** `bun scripts/derive-pack.ts polar`, which writes `../src/generated/`.


Published reference pages read for semantics and examples (2026-10-01):
- https://polar.sh/docs/api-reference/introduction (production/sandbox product lists, paging and allowances).
- https://polar.sh/docs/features/checkout/session (SDK checkout and ad-hoc prices).
- https://polar.sh/docs/features/customer-portal and its navigate-customers page (pre-authenticated portal).
- https://polar.sh/docs/features/subscriptions/introduction and trials (calendar renewals and deferred trial charge).
- https://polar.sh/docs/features/usage-based-billing/event-ingestion and meters (immutable events, filters and aggregation).
- https://polar.sh/docs/integrate/customer-state (the current customer state).
`doc-examples.json` transcribes published requests; the API reference pages embed this same OpenAPI document and publish no operation response samples. `sources.json` records checked rule citations. The ingestion SDK example's `<value>` name and `<id>` external customer are placeholders; its metadata key/value stays literal.

Reviewed primary implementation for checkout TTL and event ingestion, 2026-10-01:
- https://github.com/polarsource/polar/blob/main/server/polar/config.py and models/checkout.py (24-hour expiry).
- https://github.com/polarsource/polar/blob/main/server/polar/event/service.py (batch ingestion does not create unresolved customers).
The spec's x-codeSamples have two equivalent SDK spellings per served operation; doc-examples records each distinct wire request and cross-references both spellings.
