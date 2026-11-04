# Google OAuth 2.0 and OpenID Connect

- **Why this document:** Google publishes no OpenAPI of its OAuth 2.0 endpoints. Its Discovery document for `oauth2 v2`
  (https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest, revision 20200213) holds only userinfo and tokeninfo; the
  authorization, token, revocation, device, keys and discovery endpoints are documented on its identity pages. This
  document is written from those pages, one operation per endpoint, each naming its page (`externalDocs`):
  - https://developers.google.com/identity/openid-connect/openid-connect
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/identity/protocols/oauth2/service-account
  - https://developers.google.com/identity/protocols/oauth2/limited-input-device
- **Its hosts:** accounts.google.com, oauth2.googleapis.com, www.googleapis.com, openidconnect.googleapis.com (each path's
  `servers`), as Google's discovery document names them (`recordings/2026-09-29-openid-configuration.json`, read live).
- **Grouping:** by tag (`grouping.json`).
- **Corrections:** none.
- **Read by:** the twin orchestrator, 2026-09-29.
- **Vendored bytes (sha256):** `openapi.json` `407991d07f277614db10e6b086603faa8b072ab7d52732d4569568be0efb596d`; `grouping.json` `b643b964451fa5780111f92a2130dd4a11bdcb5ae0dd0f363f75de48edf3bf1b`.
