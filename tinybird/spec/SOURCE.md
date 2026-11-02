# Tinybird's API, as its own client calls it

- **Why this source:** Tinybird publishes no OpenAPI of its platform API. Its API reference
  (https://www.tinybird.co/docs/api-reference: Analyze, Data Sources, Events, Jobs, Organizations, Pipes, Query,
  Environment Variables, Sink Pipes, Tokens) omits endpoints its own CLI calls, `/v0/tags` and `/v0/sql_tables` among
  them. Its TypeScript SDK (@tinybirdco/sdk 0.0.84) calls a subset and neither of those. Its Python client names them all.
- **Source:** `tinybird/client.py` (class TinyB) in the wheel `tinybird_cli-6.5.5-py3-none-any.whl` from PyPI
  (https://pypi.org/project/tinybird-cli/6.5.5/), sha256 `58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39`;
  client.py sha256 `dbc0148336fdcc3ecfaaa303f25ae05d411622f6749d962e04edecb5c1b58aac`.
- **Vendored:** `client-ops.json`, the facts of each request the client makes (its method, URL, query keys, body keys
  and their types), not the client's code: the wheel carries no license text. Extracted from each `_req` call: a URL held in a local name followed to its last
  assignment before the call, query keys literal or those of the dict the
  URL urlencodes, JSON or form body keys typed by the client's own annotation of the value, `null` where it gives none.
  128 calls; `client-ops.json` sha256 `d715c04f29d5d8500ccc6ef05732ed15e245067cdc933c2b94f089d5bfcb172e`.
- **Version:** `tinybird-cli 6.5.5`
- **Read by:** `bun scripts/derive-pack.ts tinybird` (packages/world-tooling/src/spec-ir-client.ts).
- **What it does not say:** what any answer holds (the client returns the JSON it gets), and what the client builds as a
  raw string (a token's scopes, `alter_tokens`' `scopes_url`). Those come from the reference pages: answers as page
  examples (`doc-examples.json`), parameters as spec patches (`patches.json`) citing the page.
- **Where the pages are read:** at their own URLs (`https://www.tinybird.co/docs/api-reference/<api>`), whose rendered
  HTML holds each operation, its parameters, examples and response codes. A page's markdown (`<page>.md` answers 404;
  `https://www.tinybird.co/docs/md/<path>` is the "Copy as MD" form) holds only an `{% api_reference %}` tag for an
  API reference page, so the patches and examples cite the HTML page.
- **Corrections:** `patches.json` (a token's `scope`, `name` and `description` on create and on PUT; the keys of `POST
  /v0/datasources`; `POST /v0/pipes` from a JSON body of nodes; the Events API's `wait` and `format`; a delete's
  `delete_condition`, which the client's table misses, so a recorded write keeps it), each quoting its page, checked by
  `bun scripts/check-sources.ts tinybird` into `sources.json`.
- **Documented, not in the client, outside the count:** 16 operations the reference pages document, each with an
  example, that the client never calls. An operation the client omits is patched in, citing its page, when the pack
  models it; until then it is outside the spec's count and its examples are not in `doc-examples.json` (21 of them).
  - https://www.tinybird.co/docs/api-reference: `GET /v0/organizations/{organization_id}/members` (1 example).
  - https://www.tinybird.co/docs/api-reference/organizations-api: `GET /v0/organizations/{organization_id}/clusters`
    (1), `PUT /v0/organizations/{organization_id}/clusters/{cluster_id}/weights` (1),
    `POST /v0/organizations/{organization_id}/clusters/{cluster_id}/replicas` (2),
    `DELETE /v0/organizations/{organization_id}/clusters/{cluster_id}/replicas/{replica_name}` (2),
    `GET /v0/organizations/{organization_id}/clusters-configuration` (1).
  - https://www.tinybird.co/docs/api-reference/pipe-api: `PUT /v0/pipes/{pipe}/endpoint` (1),
    `DELETE /v0/pipes/{pipe}/nodes/{node}` (1), `PUT /v0/pipes/{pipe}/nodes/{node}` (1), `PUT /v0/pipes/{pipe}` (2),
    `GET /v0/pipes/{pipe}/nodes/{node}/explain` (2), `GET /v0/pipes/{pipe}/explain` (2).
  - https://www.tinybird.co/docs/api-reference/pipe-api/copy-pipes-api: `POST /v0/pipes/{pipe}/nodes/{node}/copy` (1),
    `POST /v0/pipes/{pipe}/copy/cancel` (1).
  - https://www.tinybird.co/docs/api-reference/pipe-api/materialized-views:
    `POST /v0/pipes/{pipe}/nodes/{node}/materialization` (1).
  - https://www.tinybird.co/docs/api-reference/sink-pipes-api: `GET /v0/integrations/{service}/settings` (1).
- **Published examples:** `doc-examples.json`, every example request each API reference page shows (its curl) with the
  answer the page gives for it, routed to the operation the request names; made from the rendered pages (a page's JSON
  that leaves out a comma between two members is read with it, and says so in its `means`). A body the page names as
  the reader's own file (`-F csv=@local_file.csv`, `--data-binary @body.gz`) publishes no bytes, so its example
  vendors no `input`, and says so in its `means`.

- **Published dynamic templates and stated rules:** `doc-examples.json` also records
  https://www.tinybird.co/docs/classic/work-with-data/query-parameters and
  https://www.tinybird.co/docs/classic/cli/template-functions. Their tables are reader-supplied fixtures made through
  the vendor APIs. Generic illustrative identifiers are bound to those tables; the documented function, option and
  selected rows remain the expectation. Remote import examples receive the reader’s CSV through a World-held
  application response at the published placeholder URL; the file’s exact rows are read back. No real vendor is called.

Template rule evidence: `tinybird-cli==6.5.5`, vendor wheel published at https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl, SHA256 `58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39`. Checked archive citations name `tinybird/sql_template.py`; its complete SQL render examples are replayed through existing Pipe endpoints, and client-only preflight or non-SQL snippets are not endpoint examples.
