# PostHog's public endpoints

- **Why this document:** PostHog's OpenAPI document (api/spec) covers its private API, which takes a personal API key.
  The endpoints its SDKs call with a project token (capture, flags, the JavaScript SDK's remote config and surveys) are
  not in it. This document is written from:
  - PostHog/posthog at `80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4` (read 2026-09-30): the capture service's routes and
    answer (`rust/capture/src/router.rs`, `api.rs`);
  - PostHog/posthog.com at `ab0300c8fd8f12ab21090a2921499576d036d9ed`: `contents/docs/api/capture.mdx`,
    `contents/docs/api/flags.mdx` and its snippet `contents/docs/integrate/feature-flags-code/_snippets/feature-flags-code-api.mdx`.
- **sha256** of `openapi.json`: `63baeb646ffee5cfd85454d2d8d5dfaac56f975dba9406958106c15ab34ac69b`.
- **Grouping** (`grouping.json`): an operation's family is its tag (`Capture`, `Flags`, `Config`, `Surveys`, `Static`).
- **Hosts:** `us.i.posthog.com` and `eu.i.posthog.com` (the documents' `<ph_client_api_host>`); an application's own
  proxy forwards to them.
- **Corrections:** none. The flags operation's `400` and `401` answers are written from the flags service's errors
  (`rust/feature-flags/src/api/errors.rs` at the same commit); its answer versions, defaults and fallback configuration
  are read from `rust/feature-flags/src/api/endpoint.rs`, `api/types.rs`, `handler/authentication.rs` and
  `handler/config_response_builder.rs` (cited in `../src/semantics/flags.ts`, recorded in `sources.json`), and the
  rendered page https://posthog.com/docs/api/flags supplies its published examples.

- **Writer:** `write-openapi.ts`, run from twin-packs-p3 with `bun posthog/ingest/spec/write-openapi.ts`: reads the pinned page bytes below without network access, prints their hashes, then writes the authored route/schema mapping above. PostHog publishes no OpenAPI document for these endpoints.
- **Read by:** `bun scripts/derive-pack.ts posthog/ingest`, which writes `../src/generated/`.
- **Published stated rules:** `doc-examples.json`, from the identity-resolution page, replayed by ../../journeys/vendor-examples.json.

## Pinned reference bytes

Captured through twin-standard read-page --raw. The writer decompresses these files; it reruns from this repository alone.

- `reference-0.html.gz`: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs; SHA-256 of the uncompressed bytes: `164d873c400f0a062a217ca83563ac0d7ccd5e95634c773c5d10c48938c44267`.
- `reference-1.html.gz`: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/api.rs; SHA-256 of the uncompressed bytes: `d83509535e37e1c8cfd438b654ed1d0b91e11ca23215e296a6b427f863f2c696`.
- `reference-2.html.gz`: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py; SHA-256 of the uncompressed bytes: `5b4807173f64de839ad3b60f0d4e5d95d802df1aea5cd74049c8dcbac614f1cc`.
- `reference-3.html.gz`: https://raw.githubusercontent.com/PostHog/posthog.com/ab0300c8fd8f12ab21090a2921499576d036d9ed/contents/docs/api/capture.mdx; SHA-256 of the uncompressed bytes: `8e9a3f99acb38df5b24bb948c1bd7a2f713dec5f7bc090e23a5c879e8be79e70`.
- `reference-4.html.gz`: https://raw.githubusercontent.com/PostHog/posthog.com/ab0300c8fd8f12ab21090a2921499576d036d9ed/contents/docs/api/flags.mdx; SHA-256 of the uncompressed bytes: `22a2df1da7ff4c65e805da19101b469f09145e5a541c717d89ded17e4e9b379c`.

The operations the twin serves are decided in ../../journeys/decisions.json; the rest are unmodeled.
Read by: Codex, 2026-10-03 (provenance and gap citations).
