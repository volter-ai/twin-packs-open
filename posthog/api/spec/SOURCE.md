# PostHog's API

- **Why this document:** PostHog's own OpenAPI document, as its API serves it: `https://us.posthog.com/api/schema/?format=json`
  (drf-spectacular), fetched 2026-09-30, vendored gzipped and unchanged (`openapi.json.gz`). Its source is PostHog/posthog
  at `80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4` that day.
- **sha256** of the document (`openapi.json.gz` decompressed): `42c43839ac0a32559422c5cc410f55683f6ac2cf7c3d52c887eaae6f0d96faba`.
- **Grouping** (`grouping.json`): an operation's family is its first tag (`organizations`, `persons`, `query`,
  `events`, `groups-types`), as PostHog's document groups them.
- **Servers:** `https://us.posthog.com`, `https://eu.posthog.com`; `app.posthog.com` answers as the US one.
- **Corrections** (`patches.json`): the person delete (`DELETE /api/projects/{project_id}/persons/{id}/`), which PostHog
  serves and excludes from the document on purpose.
- **Published examples** (`doc-examples.json`): the API reference's rendered examples, read with `twin-standard
  read-page` from posthog.com/docs/api/persons, /organizations, /projects, /events, /groups-types, /session-recordings
  and /queries (2026-09-30 and 2026-10-02).
- **Read by:** `bun scripts/derive-pack.ts posthog/api`, which writes `../src/generated/`.

The operations the twin serves are decided in ../../journeys/decisions.json; the rest are unmodeled.
Read by: Codex, 2026-10-03 (provenance and gap citations).
