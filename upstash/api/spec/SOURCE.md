# upstash/api spec — provenance

- **File:** `openapi.yaml.gz` (gzipped as published, the vendor's bytes unchanged inside), Upstash's Developer API document as published in its docs repository:
  https://github.com/upstash/docs `devops/developer-api/openapi.yaml` at commit
  `cc9e4f3c1f89c3fc0821f1c77d4b87de420228d1` (2026-08-26).
- **Spec version:** OpenAPI 3.0.4, `info.version` `1.0.0`; server `https://api.upstash.com/v2`; 58 operations (Redis
  databases, backups, teams, audit logs, Vector, Search, QStash), HTTP Basic auth (the account's email and an API key).
- **SHA-256:** `c04f411e882ddb2bb55edb60c93781c7adb0db5d5e4d23e68267df7d95ef0b6e`.
- **Corrections:** `patches.json` adds the database's credentials (`password`, `rest_token`, `read_only_rest_token`) to
  the `Database` schema, which names none though `getDatabase` answers them (its `credentials=hide` parameter "remove[s]
  credentials from the response"); the evidence is Upstash's own Terraform provider, which reads them from that answer
  (`upstash/terraform-provider-upstash` `upstash/redis/database/types.go`, recorded in `sources.json`).
- **Read by:** `bun scripts/derive-pack.ts upstash/api`, which writes `../src/generated/`.
- **Corrections from Upstash's CLI:** `patches.json` makes `platform` optional on `CreateDatabaseRequest` and adds its
  `region`, as `upstash redis create` sends them (`{database_name, region: "global", primary_region, read_regions}`, no
  platform; `upstash/cli` `src/commands/redis/create.ts` at `1a67be4e830bd74b622826d5b6bcf5efc81dad5d`, recorded in
  `sources.json`).
- **Outside this spec:** the Redis REST data plane the pack root serves (`../../spec/commands/`), and the console's
  pages where an API key is made (https://upstash.com/docs/devops/developer-api/introduction).
- **APIs the pages document and this spec omits, outside the count until modelled:** `POST https://api.upstash.com/apikey`
  (a Developer API key from an OAuth token) and the `https://auth.upstash.com/oauth/token` code exchange
  (https://upstash.com/docs/redis/help/integration), and `POST https://upstash.com/start-redis`, the free database with no
  account that `createDatabase`'s own description names.
- **The pages' examples** (`doc-examples.json`): every reference page Upstash renders from this document, 58 in all: the
  `devops/developer-api/*` pages (redis, backups, teams, account, vector) and the `api-reference/qstash/*`,
  `api-reference/search/*` and `api-reference/vector/get-index-stats`/`get-vector-stats` pages. Each of those names this
  document as its source (`/devops/developer-api/openapi.yaml <method> <path>` in https://upstash.com/docs/llms-full.txt)
  and renders a request to `https://api.upstash.com/v2`, so they are this lane's, not the qstash lane's (whose pages
  render from `/qstash/openapi.yaml` and `/workflow/openapi.yaml`) nor the vector pack's. A page of an operation the lane
  does not serve is counted, not replayed. The document gives `/auditlogs` its own server (`https://api.upstash.com`, no
  `/v2`); the derived surface carries it as that operation's base path, so its page's request routes to it.
- **Errors:** the document declares no error response and no page documents an error body (Upstash's CLI reads
  `error ?? message`). https://upstash.com/docs/devops/developer-api/http_status_codes lists the statuses; only its 401 row
  ("Your API key is wrong") is specific to this API, the other rows' texts are template text (a "kitten" for 403, 404, 405
  and 429). Each refusal's status is the twin's reading of that page.

## Captured example sanitation

The unsanitized `doc-examples.json` capture is retained outside the package at
`/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/upstash/api/spec/doc-examples.json`.
The following captured string values matched the exact-archive sweep's `generic-api-key` rule. Each is replaced with
the inert string `"INERT"`; all other capture bytes and every upstream page locator remain unchanged. The OpenAPI
document is unchanged. These Developer API operations have no served response handler; the captured output fields
remain JSON strings, and console-issued credentials still come from native stored rows.

| JSON pointer in `doc-examples.json` | Reason |
| --- | --- |
| `/2/output/token` | Credential-like QStash token example; captured line 37. |
| `/2/output/read_only_token` | Credential-like QStash read-only token example; captured line 38. |
| `/5/output/0/token` | Credential-like QStash token example; captured line 196. |
| `/5/output/0/read_only_token` | Credential-like QStash read-only token example; captured line 197. |
| `/7/output/token` | Credential-like QStash token example; captured line 264. |
| `/7/output/read_only_token` | Credential-like QStash read-only token example; captured line 265. |
| `/10/output/token` | Credential-like Search token example; captured line 355. |
| `/10/output/read_only_token` | Credential-like Search read-only token example; captured line 356. |
| `/13/output/token` | Credential-like Search token example; captured line 533. |
| `/13/output/read_only_token` | Credential-like Search read-only token example; captured line 534. |
| `/15/output/0/token` | Credential-like Search token example; captured line 592. |
| `/15/output/0/read_only_token` | Credential-like Search read-only token example; captured line 593. |
| `/50/output/token` | Credential-like Vector token example; captured line 1770. |
| `/50/output/read_only_token` | Credential-like Vector read-only token example; captured line 1771. |
| `/52/output/token` | Credential-like Vector token example; captured line 1829. |
| `/52/output/read_only_token` | Credential-like Vector read-only token example; captured line 1830. |
| `/53/output/0/token` | Credential-like Vector token example; captured line 1877. |
| `/53/output/0/read_only_token` | Credential-like Vector read-only token example; captured line 1878. |

Authored Redis console navigation and credential presentation, reference read 2026-10-08: https://upstash.com/docs/redis/overall/getstarted and its published database screenshot (capture date unspecified), plus https://upstash.com/docs/redis/features/restapi. Stored databases, credentials and existing create/delete rules remain the behavior. Usage/billing charts, read regions, paid plans and other products are not fabricated; unavailable tabs are marked. No reference image, DOM or scripts are shipped.

Authored QStash console layout and mounted navigation, reference read 2026-10-08: https://upstash.com/docs/qstash/overall/getstarted and its published Quickstart environment image, https://upstash.com/docs/qstash/howto/reset-token and https://upstash.com/docs/qstash/howto/roll-signing-keys and their action images (capture dates unspecified). The existing region selection, stored endpoint/credentials, token reset and signing-key rotation remain the behavior. Credentials are masked with explicit Show/Copy controls; Reset token opens a confirmation dialog. Redis and QStash navigation and forms stay under the serving World mount. Message, usage and cost charts are omitted; unserved tabs are unavailable. The vendor's read-only-token switch is not reproduced. No vendor image, DOM, scripts or sign-in session is shipped.

Data Browser reference read 2026-10-09: https://upstash.com/blog/session-management-nextjs (published 2024-10-30). Its published screenshot supplies the database Data Browser tab, Search/All Types/Refresh row in the key sidebar, selected-key content panel and TTL footer. The original image was read without vendor sign-in; SHA-256 `dc3fe446d9b42b715a257bdd05225546dd4752c13a9fc8d9704ab1efe4b5807b`. The article’s date is known; the screenshot’s capture date is unspecified. This is a historical visual reference, not evidence of every current vendor control. https://upstash.com/docs/redis/troubleshooting/command_count_increases_unexpectedly documents SCAN, GET and TTL for Data Browser. The authored read-only screen reads the kernel Redis projection through the already-owned database scope; no reference image, DOM, script or vendor session ships. Source-page words were read in authoring; no check-sources or other check was run.
