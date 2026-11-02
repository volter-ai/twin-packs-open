# Volter Identity's API

- **Why this document:** Volter is the vendor. id.volter.ai (volter-ai/identity, `daa98e9a5f6409ce7fc6483a1e03b7de69d8dcc2`,
  read 2026-09-29) publishes no OpenAPI document; it serves its OpenID Connect discovery document at
  `/.well-known/openid-configuration`.
- **Its three parts:**
  - `/api/auth/*`: Better Auth 1.7.5 with the plugins `worker/src/auth.ts` configures (lastLoginMethod, emailOTP,
    passkey, organization, jwt, oauthProvider, oauthDeviceAuthorization; GitHub and Google as social providers), as
    better-auth's own `openAPI` plugin generates them (`auth.api.generateOpenAPISchema()`, better-auth 1.7.5,
    @better-auth/oauth-provider 1.7.5, @better-auth/passkey 1.7.5: the versions identity's package-lock pins). The
    document's server, `https://id.volter.ai/api/auth`, is folded into its paths.
  - `/api/people` and `/api/organizations`: the product organizations API of `worker/src/product.ts`, written here from
    that source (its routes, bodies and answers).
  - `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`: the routes of `worker/src/index.ts`.
  - `/admin/clients`, `/admin/resources` and `/admin/clients/{client_id}/resources` (POST): the operator's registration
    routes of `worker/src/index.ts` lines 47-89 at `daa98e9` (the signed-in-session check, then the admin token, then
    Better Auth's `adminCreateOAuthClient`, `adminCreateOAuthResource` and `adminLinkClientResource`), written here
    from that source with the request bodies of @better-auth/oauth-provider 1.7.5's admin endpoints; the client update
    (`PATCH /admin/clients/{id}`) is not written, as no product calls it.
- **Grouping:** by tag (`grouping.json`): Better Auth's plugins, `Product`, `Discovery`, `Admin`.
- **Corrections:** `patches.json` gives the Product answers their concrete named resource schemas and arrays, and names the admin client response. Each patch quotes the pinned vendor source snapshots in `recordings/product-source.txt` and `recordings/provider-source.txt`; these are source snapshots, not fabricated API observations. (The product operations are named `product<Name>`, so none collides with a Better Auth operation.)
- **Read by:** the twin orchestrator, 2026-09-29; the admin routes by the volteridentity builder, 2026-10-01.
- **Vendored bytes (sha256):** `openapi.json` `a11d272b527192f45bc99f3c96dd6803506f4b3ddebefde2b2fdb8a60d73f745`; `grouping.json` `b643b964451fa5780111f92a2130dd4a11bdcb5ae0dd0f363f75de48edf3bf1b`.

- **Independent review sources (2026-10-01):** `recordings/product-source.txt` is `worker/src/product.ts` at the identity commit above; `recordings/provider-source.txt` preserves the cited excerpts from the pinned npm package at `dist/authorize-riRRCSbC.mjs`, `dist/introspect-njKASm3q.mjs` and `dist/utils-CWjOhEQb.mjs`. They document authorization validation, consent, opaque access tokens and ID-token claims.

- `x-resourceId` corrections name every resource explicitly: the derivation otherwise infers only schemas read by GET and excludes registration-only clients. These declarations preserve the existing resource names and add oauth_client, whose identity is client_id.

- `recordings/auth-source.txt` and `recordings/ui-source.txt` preserve worker/src/auth.ts and worker/ui/identity.ts at the same pinned identity commit: actual verification flags, session configuration, and the session-required device page with return_to after plain sign-in. They are source snapshots.

- `recordings/provider-signing-source.txt` preserves access-token payload construction and conditional not-before signing from the same pinned 1.7.5 provider and Better Auth packages. Their payloads include iat and exp without a default nbf claim.

- `doc-examples.json` records source-stated rules from Better Auth's OAuth-provider page, its OAuth reference (RFC 6749), and `recordings/product-source.txt` at the pinned identity commit (member role update lines 126-129). The raw product source URL is currently private (404); the committed source snapshot retains the vendor rule. The native redirect and Basic authentication options are replayed with their effects asserted; consent-dependent authorization is a separate unmodeled flow.

- The native Apple request in `journeys/customer-life.json` follows RH2 `apps/rh2-mobile/apple.ts:41,46` at the demand-pinned commit: a failed sign-in throws before :49/:51 claim and approval. Better Auth 1.7.5's [provider verifier](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/core/src/oauth2/verify-id-token.ts) returns false when verification throws; [social sign-in](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/api/routes/sign-in.ts) answers UNAUTHORIZED with INVALID_TOKEN. Read against the pinned npm packages: `@better-auth/core@1.7.5:dist/oauth2/verify-id-token.mjs`, `better-auth@1.7.5:dist/api/routes/sign-in.mjs:159-161`; Apple's provider reads `https://appleid.apple.com/auth/keys` (`@better-auth/core@1.7.5:dist/social-providers/apple.mjs:87-92`). A World with no Apple twin refuses that fetch. The life keeps a synthetic opaque request token and receives the documented error; it holds no provider keys or response. Only a World backed by the real Apple reaches the recorded verified-token sign-in path. [Apple's support page](https://support.apple.com/en-us/102609) describes Hide My Email's separate relay address.

- Refresh-family policy (provider1.7.5, read2026-10-28): `recordings/provider-refresh-source.txt` is the exact installed `@better-auth/oauth-provider@1.7.5/dist/introspect-njKASm3q.mjs`, SHA256 `3f083ce504d52e712faa5cf905c59e7ad1159285f44a08c617885fb9d111ae47`. Its `createRefreshToken` retains revoked predecessors; `invalidateRefreshFamily` removes refresh rows for the client/user pair and only opaque access rows referencing them. `handleRefreshTokenGrant` rejects unknown, wrong-client and expired tokens before invalidation. This pack models the issuer's existing zero-grace configuration, not the separately proposed thirty-second encrypted-response replay. A new ordinary device grant remains issuable after family invalidation.
  The retained dependency source is MIT-licensed; its exact notice is `recordings/provider-refresh-LICENSE.md`.
  Its `createUserTokens` keeps refresh eligibility from an existing grant's `offline_access` when requested scopes narrow; the successor stores only the narrowed scopes. Its refresh-grant handler checks the held resource before the requested scope subset.
