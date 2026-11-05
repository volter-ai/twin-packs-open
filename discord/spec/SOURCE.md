# discord spec — provenance

- **File:** `openapi.json.gz`, gzip of Discord's published OpenAPI 3.1 document for API v10.
- **Upstream:** https://github.com/discord/discord-api-spec, `specs/openapi.json` on `main` at `bb8eb1ec745a`
  (committed 2026-09-17, fetched 2026-09-30). Discord marks the document a public preview.
- **Spec version:** `10` (`info.version`); base `https://discord.com/api/v10`. The twin serves `/api` and `/api/v9` as
  `/api/v10` (the manifest's `basePathAlias`); an unversioned path is v6 at Discord, answered here as v10.
- **SHA-256 of the uncompressed document:** `c7fcfce6c671c91491d62763b87cb373ac4aa9b649fba5d0e7fe86aedda9fbf3`.
- **Corrections:** `patches.json` (RFC 6902, each with its reason): the token URL, which the document names only as the
  OAuth2 scheme's refresh URL, added as the operation `oauth2_token`. The authorize page
  (https://docs.discord.com/developers/topics/oauth2) is a screen, not an operation.
- **Published examples:** the document carries none; `doc-examples.json` holds the examples and stated rules of Discord's
  pages for the operations served (topics/oauth2, events/gateway, resources/user, resources/message, reference,
  topics/opcodes-and-status-codes, resources/channel, resources/guild, topics/permissions, resources/webhook,
  interactions/application-commands), interactions/receiving-and-responding, each with its page's URL and words, read with `twin-standard read-page` on
  2026-10-01 (the reaction, edit and current-user rules, and the application commands, on 2026-10-02).
- **Cited pages:** `sources.json`, check-sources' record of every page a `// source:` line cites.
- **Read by:** `bun scripts/derive-pack.ts discord`, which writes `../src/generated/surface.gen.json`.

## Packaged public example scalars

`spec/doc-examples.json` retains the pinned source above with only the string-scalar replacements listed below. Original inputs are retained outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/discord/spec/doc-examples.json`. Original uncompressed SHA-256: `a55795ab2a8efe461da95dbad3cf298e8a3d71286f88f0ef13e4ec6a4c7c9a33`; packaged uncompressed SHA-256: `50b455dd4cee6ca33b95840a231bab8cd79e2f82595a4499dd26ee32163f0fa8`. Every byte outside the listed JSON string values is unchanged. These public samples are inert; runtime credentials are issued through the existing doors.

| JSON pointer | Packaged value | Reason |
| --- | --- | --- |
| `/0/output/access_token` | `example-discord-token-1` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/0/output/refresh_token` | `example-discord-token-4` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/2/output/access_token` | `example-discord-token-1` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/2/output/refresh_token` | `example-discord-token-4` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/3/output/access_token` | `example-discord-token-1` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/4/output/access_token` | `example-discord-token-2` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/4/output/refresh_token` | `example-discord-token-5` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/5/output/access_token` | `example-discord-token-3` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/5/output/refresh_token` | `example-discord-token-6` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/5/output/webhook/token` | `example-discord-token-7` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
| `/5/output/webhook/url` | `https://discord.com/api/webhooks/347114750880120863/example-discord-token-7` | Preserves the webhook token component of its public example URL. |
| `/6/output/application/verify_key` | `0000000000000000000000000000000000000000000000000000000000000000` | Public token/key sample replaced with an inert value; repeated samples retain equality. |
