# turbopuffer spec — provenance

- **File:** `openapi.yaml.gz`, gzip of the OpenAPI document turbopuffer's official TypeScript client was generated
  from, the vendor's bytes unchanged inside (OpenAPI 3.1.0, `info.version` `0.0.1`).
- **Upstream:** the client's `.stats.yml` at tag `v2.8.0`
  (https://github.com/turbopuffer/turbopuffer-typescript/blob/v2.8.0/.stats.yml; 2.8.0 is the version dubinc/dub pins)
  names `openapi_spec_url`
  https://storage.googleapis.com/stainless-sdk-openapi-specs/turbopuffer-benesch/turbopuffer-e18ebc6e8f59aa35045717e326162e1e56ac3f344771f4149e17e1104f7b1c06.yml,
  `openapi_spec_hash` `3db106e23d2536c8a73917ebb6047b19` (the MD5 of these bytes) and 14 configured endpoints. Fetched
  2026-09-27.
- **Also published:** turbopuffer's API overview names a public specification, https://github.com/turbopuffer/turbopuffer-openapi
  (https://turbopuffer.com/docs/auth, "Specification"). Its `openapi.yml` at commit `155e59adbecaa92b00a9c66edfad419cf0fe5c17`
  (2026-08-04), whose `.stats.yml` names the same spec hash, parses to the same document as this file (it differs
  only in YAML formatting). That repository's head has moved on (16 endpoints, adding the asynchronous copy's start and
  poll); the file vendored here is the one the pinned client speaks.
- **SHA-256 of the uncompressed document:** `245e887f04ab7c111d8ab8b0812a631a0f04f4a7804f2f04c6601d90d090a27b`.
- **Operation ids:** the document names none, so each operation's id is the reader's `method_path` slug
  (`post_v2_namespaces_namespace` is the write, `post_v2_namespaces_namespace_query` the query).
- **Corrections:** `patches.json` (RFC 6902, each with its reason and evidence), applied before the IR. The document
  writes three pseudo-paths, `/v2/namespaces/{namespace}?stainless_overload=branchFrom`, `...?stainless_overload=copyFrom`
  and `/v2/namespaces/{namespace}/query?stainless_overload=multiQuery`: its generator's way of giving one path and
  method a second client method. The client sends that query key (`src/resources/namespaces.ts` at v2.8.0), but
  turbopuffer's documentation names no such parameter: it branches and copies with `branch_from_namespace` and
  `copy_from_namespace` in the body of `POST /v2/namespaces/:namespace` (https://turbopuffer.com/docs/write,
  https://turbopuffer.com/docs/branching) and posts a multi-query's `queries` to the plain query path
  (https://turbopuffer.com/docs/query). The patches fold each pseudo-path into that operation (the write body already
  has both fields; the copy's `dest_encryption` moves into `CopyFromNamespaceConfig`; the query takes either body and
  answers `QueryResult` or `MultiQueryResult`), leaving 13 operations. The derived routes retain the documented paths; all operations are unmodeled.
  **Inference, not observation:** that turbopuffer's own server ignores `stainless_overload` is read from the
  documentation, which never mentions it; no request to the real service was made.
- **Read by:** `bun scripts/derive-pack.ts turbopuffer`, which writes `../src/generated/`.
- **Pages cited:** the documentation's curl examples are rendered in the HTML pages' script payload, not their text;
  the `.md` form of a page (https://turbopuffer.com/docs/query.md, listed in https://turbopuffer.com/llms.txt) is cited
  where a quote comes from one.
- **The pages' examples** (`doc-examples.json`, 99): every example turbopuffer's documentation publishes for an
  operation of this spec, from the API reference (Overview, Write, Query, Namespace metadata, Warm cache, List namespaces,
  Delete namespace, Recall) and the guides (Quickstart, Full-Text Search, Branching, Embedding, Permissions, Ingestion,
  Regions, Testing, Export, Backups, Pinning), read from each page's `.md` form (https://turbopuffer.com/llms.txt lists
  them). An example is one request: a page's multi-language block shows one request in each client language, so it
  counts once, by its curl form where it has one and otherwise by the request the page's client code sends (the
  Embedding page's TypeScript, the Backups, Export, Testing, Pagination and custom-tokenization Python). The Chunking
  page's example calls no turbopuffer operation, and the Quickstart's Connect block only sets shell variables; neither is
  counted. The examples of Pinning (`PATCH /v1/namespaces/{namespace}/metadata`) and Recall are counted and not
  replayed: the twin does not serve those operations.
- **Where the pages and this spec disagree:** the metadata page's example names `approx_size_bytes`,
  `approx_num_rows` and `encryption.sse`, while its Response section and the spec name `approx_logical_bytes`,
  `approx_row_count` and `encryption.mode`. The delete page shows `status: ok`, while the spec answers `OK`.
  The spec defaults `remove_stopwords` to true and names `$embed_<attribute>`; the Write page defaults it to false
  and names `embed_<attribute>`. No operation is served, so these examples remain unserved rather than replayed.
- **APIs the pages document and this spec omits, outside the count until modelled:** the asynchronous form of a copy
  (`Prefer: respond-async`, answered 202 with a `Location` to poll, https://turbopuffer.com/docs/auth "Asynchronous
  requests"), and the export read `GET /v1/namespaces/{namespace}` and `HEAD /v1/namespaces/{namespace}`, which the
  document's own header says it leaves out (deprecated in favour of paging queries and the schema).
- **Outside any API:** API keys are made and expired on turbopuffer's dashboard ("You can create and expire tokens in
  the dashboard", https://turbopuffer.com/docs/auth); its audit log names the two acts (`api-key-created`,
  `api-key-marked-as-expired`, https://turbopuffer.com/docs/audit-logs).
