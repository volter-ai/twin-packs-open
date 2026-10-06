# PostgREST (Supabase's `/rest/v1`) — provenance

- **What stands in for a spec:** PostgREST publishes no fixed OpenAPI document: its OpenAPI description is generated from
  each database's schema, served at the API's root (`GET /rest/v1/`), and differs per project. The API's request grammar is
  what its own client builds, so the surface is the calls `@supabase/postgrest-js` makes (the client supabase-js uses for
  every table and function call), read from its source: `client-ops.json`, in the form `scripts/derive-pack.ts` reads
  (`packages/world-tooling/src/spec-ir-client.ts`). Each call is `{client, line, method, url, query, body}`: the client
  method, its line in the package's source, the method and path it sends, the query keys it sets itself and its body.
- **Upstream:** `@supabase/postgrest-js` 2.117.2 on npm (the version installed in this repository's `bun.lock`),
  `src/PostgrestQueryBuilder.ts` (`select` line 932, `insert` 1112, `upsert` 1390, `update` 1590, `delete` 1749) and
  `src/PostgrestClient.ts` (`rpc` lines 545 and 556, `getOpenApiSpec` 303). A filter (`eq`, `is`, `in`, …) and a modifier
  (`order`, `limit`, `range`) are query keys the client builds from a column's name, so no call names them: the grammar is
  the engine's (`../../src/engine/postgrest.ts and its postgrest-*.ts`), PostgREST's query language over the project's schema.
- **SHA-256** (the vendored file, which is the pack's own reading of the client, not a vendor document):
  recorded by `sha256sum client-ops.json` in this directory's `client-ops.json.sha256`.
- **Corrections:** none.
- **Evidence for rules:** PostgREST's error catalogue (https://docs.postgrest.org/en/stable/references/errors.html) and
  the engine's differential record against PostgREST 16.4 (the pack README: 72/72 identical answers, 2026-09-28).
- **Read by:** `bun scripts/derive-pack.ts supabase/rest`, which writes `../src/generated/`.
