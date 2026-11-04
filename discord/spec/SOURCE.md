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
