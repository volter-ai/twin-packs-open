# twitch id spec — provenance

- **Why this document:** Twitch publishes no OpenAPI document of its authentication service at `id.twitch.tv`. This
  one is written by hand from its authentication pages, each read with `twin-standard read-page` on 2026-10-07:
  - https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/: `POST /oauth2/token` with the client credentials,
    authorization code and device code grants (their form parameters and answers), and `POST /oauth2/device`;
  - https://dev.twitch.tv/docs/authentication/refresh-tokens/: the refresh token grant and its failure answer;
  - https://dev.twitch.tv/docs/authentication/validate-tokens/: `GET /oauth2/validate`, its answer and its 401;
  - https://dev.twitch.tv/docs/authentication/revoke-tokens/: `POST /oauth2/revoke` and its 400 and 404.
  The authorize page (`https://id.twitch.tv/oauth2/authorize`, the same pages' implicit and authorization code flows)
  is a page a person is sent to, not an API: it is the lane's screen. Twitch's OpenID Connect endpoints
  (https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/) were not read and are not in the document.
- **Its host:** id.twitch.tv.
- **Corrections:** none.
- **Vendored bytes (sha256):** `openapi.json` `bf2ecac043ee9e7c4bd55e0c7c865e91e32a8ffaaafdb102406369454641a047`.
- **Cited pages:** `sources.json`, check-sources' record of every page a `// source:` line cites.
- **Read:** 2026-10-07, by the twitch twin's builder.
