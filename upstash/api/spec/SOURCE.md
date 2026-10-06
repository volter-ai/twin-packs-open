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
