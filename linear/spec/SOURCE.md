# linear spec — provenance

- **GraphQL:** `schema.graphql.gz`, gzip of Linear's published schema, https://github.com/linear/linear
  `packages/sdk/src/schema.graphql` on `master` at `2a3ac4cfd28a` (committed 2026-09-28, fetched 2026-09-30); the API
  is served at https://api.linear.app/graphql. SHA-256 of the uncompressed schema: `cc4263f66d6e79f188b1e6b08af5f0fe8dd32dd3c0cdae3c070606e8d1e5e0eb`.
- **OAuth:** `openapi.json`, written from https://linear.app/developers/oauth-2-0-authentication (Linear publishes no
  OpenAPI document): the token URL and the revoke URL. The authorize page (linear.app/oauth/authorize) is a screen.
  SHA-256: `5ee78cc5a9fd3d614f96150ccc8c63d5d75e540a09c35b93ca6515e9d7691d29`.
- **Corrections:** none.
- **Read:** from the vendored SDL and the linked reference pages.

- **Documented examples:** `doc-examples.json`, transcribed from the published GraphQL,
  pagination, filtering and OAuth pages on 2026-10-01; placeholder ids are replaced with
  captured API ids in the replay. Out-of-scope selected fields and grant modes are recorded
  with their reason in `journeys/vendor-examples.json`.
- **Additional pages read:** https://linear.app/developers/pagination,
  https://linear.app/developers/filtering, https://linear.app/developers/rate-limiting,
  https://linear.app/developers/webhooks and
  https://linear.app/developers/oauth-actor-authorization. The current life does not configure
  a webhook; it uses the documented app actor and token retry grace.

Published actor issue creation is transcribed in `doc-examples.json` from https://linear.app/developers/oauth-actor-authorization (read 2026-10-01); its literal team id is replaced by a captured World id in the replay.

The official SDK 86.0.0's unchanged User, Team and Issue fragments are read alongside this pinned SDL.
The installed customer entry follows https://linear.app/developers/sdk-fetching-and-modifying-data.
Profile initials and profile URL forms are read from https://linear.app/docs/profile and
https://linear.app/docs/members-roles; team opt-in features are read from https://linear.app/docs/teams
and https://linear.app/docs/use-cycles. These pages do not establish the starter's inactive numeric
settings, avatar palette, invitation hashes, app actor email or branch template; those values are
labeled synthetic in the shared model and package README rather than asserted as vendor defaults.
