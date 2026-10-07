# Clerk Frontend API spec — provenance (the Frontend API lane)

- **File:** `openapi.yaml.gz`, Clerk's own OpenAPI document for the Frontend API, the vendor's bytes unchanged and
  gzipped (`gzip -9 -n`): OpenAPI 3.0.3, `info.title` "Clerk Frontend API", `info.version` `v1`, 594,027 bytes, 210
  operations under `https://{domain}.clerk.accounts.dev` (a development instance's Frontend API host). Its paths
  overlap the Backend API's at `/v1/organizations/…`, `/.well-known/jwks.json` and `/api_keys`: the two APIs are told
  apart by host and credential, not by path.
- **Upstream:** https://raw.githubusercontent.com/clerk/openapi-specs/main/fapi/2026-05-12.yml (repository
  `clerk/openapi-specs`, whose last commit touching the file was `7fcc9874cdd30937e7b75384ca21bdee3e46ecff`,
  2026-09-22), fetched 2026-09-28; the newest of the repository's `fapi/` versions (2021-02-05 … 2026-05-12). Fetched
  again on 2026-09-28 and compared: the same bytes.
- **SHA-256 of the vendor's bytes** (uncompressed): `17b568daf5073bfc2fecac17e50cc81f4614d015a1cbf273d7f8f31cc3167902`.
- **Corrections:** none (no `patches.json`).
- **Read by:** `bun scripts/derive-pack.ts clerk/fapi`, which writes `../src/generated/`.
- **License:** MIT (the document's `info.license`).
- **Recordings** (`recordings/2026-09-28-clerk-clerk-com-signed-out.json`): unauthenticated GETs of Clerk's own
  instance's Frontend API (https://clerk.clerk.com, the instance clerk.com signs in with) on 2026-09-28, as a browser
  with no session: an unknown path is Go's `404 page not found` (`text/plain`); `GET /v1/client` with no cookie is 200
  with a new client; `/v1/me`, `/v1/me/organization_memberships`, `/v1/client/sign_ins/{id}` and
  `/v1/organizations/{id}` are 401 `signed_out` ("Signed out", "You are signed out"). `GET /v1/environment` answered
  200 (its body not kept).

- **OAuth evidence:** the authorize, token and consent facts are this pinned spec's operation descriptions; the sign-in and consent page flow and proxy headers are Clerk's guides, recorded with checked quotes in `sources.json`. The token-type discriminator is the published `@clerk/backend@3.11.6` archive, pinned by SHA-256 in the same record.
