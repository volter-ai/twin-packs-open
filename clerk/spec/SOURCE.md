# Clerk Backend API spec — provenance (WIP: the migration's step 1)

- **File:** `openapi.yaml.gz`, Clerk's own OpenAPI document for the Backend API, the vendor's bytes unchanged and
  gzipped (`gzip -9 -n`): OpenAPI 3.0.3, `info.title` "Clerk Backend API", `info.version` `2026-05-12`, 756,422 bytes,
  252 operations under `https://api.clerk.com/v1` (its one `servers` entry).
- **Upstream:** https://raw.githubusercontent.com/clerk/openapi-specs/main/bapi/2026-05-12.yml (repository
  `clerk/openapi-specs`, whose last commit touching the file was `5f698c67972e05c0bb2a42d6616cb88066b65b6f`,
  2026-09-23), fetched 2026-09-28. The same file the harness-era census fixture was scoped from on 2026-09-02 (retired with
  the harness).
- **SHA-256 of the vendor's bytes** (uncompressed): `4c42713b9fc0d68a5f5263286fb6c87bab6320d74be261acb8a77bc1ad26d2bd`.
- **License:** MIT (the document's `info.license`, https://github.com/clerk/openapi-specs/blob/main/LICENSE).
- **Corrections:** none yet (no `patches.json`).
- **Recordings** (`recordings/2026-09-28-unauthenticated.json`): the live API's answers on 2026-09-28 with no key or
  one Clerk never issued, no Clerk account used: no `Authorization` header, or a non-Bearer one, is 401
  `authorization_header_format_invalid` ("Invalid Authorization header format"); a Bearer key Clerk never issued
  (`sk_test_notakey`, `notakey`) is 401 `clerk_key_invalid`; both are answered before any path is routed (an unknown
  path answers the same 401).
- **Read by:** `bun scripts/derive-pack.ts clerk`, which writes `../src/generated/`.
- **The Frontend API** (what clerk-js calls on the instance's `*.clerk.accounts.dev` / `clerk.<domain>` host) is a
  separate document, vendored in `../fapi/spec/` (see its SOURCE.md).
- **Published examples** (`doc-examples.json`, replayed by `../journeys/vendor-examples.json`): the spec publishes no
  example per operation (its ~370 `example:` values are field values, which the standard does not count as examples).
  Clerk's documentation pages (every page `https://clerk.com/docs/llms.txt` lists, read 2026-09-28) publish:
  - **request examples** as `curl` commands against `https://api.clerk.com`, with no answers: every one is vendored, 20
    in all. The 12 of served operations are replayed (`CreateUser`, `DeleteUser`, `UpdateUserMetadata`,
    `ReplaceUserMetadata`, `ReplaceOrganizationMetadata`, `CreateSignInToken` from two pages, and the invitations guide's
    five: create, `redirect_url`, `public_metadata`, bulk, revoke). The 8 of operations the twin does not serve are
    counted, not replayed; the OAuth token page writes its URL without the `/v1` base path, so that one is named by
    its operation (`verifyOAuthAccessToken`) and not by its URL.
  - **rules**: https://clerk.com/docs/guides/development/errors/backend-api, each entry a refusal with its status and
    long message. The page does not tie an entry to an operation, so each entry's operation is the author's reading:
    a generic rule (FormMissingParameter, FormInvalidEmailAddress, …) is vendored on the one served operation it is
    replayed against, and is a rule of every operation it applies to. Entries for operations or features the twin does
    not serve are left out; entries the author read as applying to a served operation the twin does not model (a pwned
    password, SCIM, billing, a user quota, IdP metadata fetched or parsed) are vendored and recorded in `notReplayed`,
    each with why.
  - no Backend API answer as JSON: the pages' only JSON bodies are webhook payloads, JWT template claims and the errors
    pages' entries.

- **Proxy Frontend API host:** https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi, read 2026-10-03. It requires same-site proxy requests to reach `frontend-api.clerk.dev` with their body and headers; that host routes to the Frontend API lane. The demanded caller is vgauth (its pinned Worker `CLERK_FAPI_ORIGIN`, `../vgauth/spec/recordings/worker-source.txt:106,279-284`).
