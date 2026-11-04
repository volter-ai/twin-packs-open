# vercel spec — provenance

- **File:** `openapi.json.gz`, gzip of Vercel's published OpenAPI document as it serves it: https://openapi.vercel.sh/,
  fetched 2026-09-27 (11,425,185 bytes).
- **Spec version:** OpenAPI 3.0.3, `info.version` `0.0.1`; server `https://api.vercel.com`; 431 operations.
- **SHA-256 of the uncompressed document:** `3110ebd0d07b1539e6ad04bf3af399fd98ef9d84bd97e206790039d5e1371b18`.
- **Corrections:** `patches.json` adds `PATCH /v1/edge-config/{edgeConfigId}/items`, the path Dub sends Edge Config item
  updates to, beside the document's `/v1/global-config/{edgeConfigId}/items`; it rests on Dub's source (recorded in
  `sources.json`), not on Vercel's reference, which documents only the global-config path.
- **Read:** at this checkout, and by independent life/example reviewers; `bun scripts/derive-pack.ts vercel`, which writes `../src/generated/`.
- **Outside this spec:** the twin's own doors (`/_twin/*`), avatar.vercel.sh, the Edge Config read host
  (edge-config.vercel.com, its own API), and the dashboard's pages at vercel.com (`src/screens/{login,account-tokens,
  stores,edge-config}`), with the World's sign-up and mailbox doors beside them.
- **Page examples:** `doc-examples.json`, one per page of Vercel's REST reference (the 422 pages its index,
  https://vercel.com/docs/rest-api, links; each read as markdown at `<page>.md`, fetched 2026-09-26): the page's example
  request (its cURL tab, or the operation's own `x-code-samples` where the page shows that alone), its example response
  and its success status, routed to the operation its `http` line names. All 422 route; the four HEAD pages among them
  (`/v8/artifacts/{hash}` and three beside it) route to operations the twin does not serve. The pages render each example
  from the operation's schema: every property present, and every scalar written as a string (`"createdAt": "123"`,
  `"verified": "false"`), the request bodies too (`"ttl": "60"`).
- **Rendered:** 370 entries of `doc-examples.json` are `"rendered": true`: the page generator writes each example from the
  operation's schema (every property, every scalar as a string), so each is read as a sample of that schema. The other
  52 are the pages whose success status the spec gives no JSON schema: 47 publish no example response (a 204, an
  empty 200, a HEAD), and 5, of operations the twin does not serve, a JSON-lines one.

## Captured example sanitation

The unsanitized `doc-examples.json` capture is retained outside the package at
`/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/vercel/spec/doc-examples.json`.
The following captured string values matched the exact-archive sweep's `generic-api-key` rule. Each is replaced with
the inert string `"INERT"`; all other capture bytes and every upstream page locator remain unchanged. The OpenAPI
document is unchanged. These access-group, authentication-token and API-key operations have no served response
handler; the captured output fields remain JSON strings. Served token and project doors use native stored rows.

| JSON pointer in `doc-examples.json` | Reason |
| --- | --- |
| `/1/output/accessGroupId` | Access-group identifier example matched the credential rule; captured line 45. |
| `/8/output/accessGroupId` | Access-group identifier example matched the credential rule; captured line 184. |
| `/10/output/accessGroupId` | Access-group identifier example matched the credential rule; captured line 243. |
| `/36/output/bearerToken` | Credential-like bearer-token example; captured line 1048. |
| `/37/output/tokenId` | Token identifier example matched the credential rule; captured line 1086. |
| `/359/output/apiKeyString` | Credential-like API-key example; captured line 20391. |
