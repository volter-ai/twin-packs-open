# Daily spec — provenance

- **File:** `openapi.json`, Daily's own OpenAPI document, the vendor's bytes unchanged (OpenAPI 3.0.3, `info.title`
  "Daily API", `info.version` `1.1.1`, 428,463 bytes, 66 operations under `https://api.daily.co/v1`).
- **Upstream:** https://docs.daily.co/openapi.json (ETag `W/"pY6A7gmXueT4MmS2"`, `last-modified: Thu, 17 Sep 2026
  07:46:25 GMT`), fetched 2026-09-28. The documentation names it: "The complete Daily REST API is described by an
  OpenAPI 3.0 specification: https://docs.daily.co/openapi.json" (https://docs.daily.co/docs/rest-api/index), and
  https://docs.daily.co/llms.txt lists it under "OpenAPI Specs".
- **SHA-256 of the vendor's bytes:** `4a28ab33068ef0294ef30598763d38ab929f17c67cf43201e413e6e112ab6d7b`.
- **License:** the document states none; it is published on Daily's documentation site for clients to read ("Use it
  to generate API clients, import the API into tools like Postman"), and is vendored unmodified, corrected only by
  `patches.json`. Daily publishes no official REST client for Node; its call clients (`@daily-co/daily-js`,
  `@daily-co/daily-react`) drive calls, not this API, and are not dependencies of the pack.
- **Operation ids:** the document's own (`CreateRoom`, `GetRoomConfig`, `SetRoomConfig`, …); the batch processor's,
  patched in, are the twin's (`BatchProcessorSubmitJob`, `BatchProcessorListJobs`, `BatchProcessorGetJob`,
  `BatchProcessorGetJobAccessLink`, `BatchProcessorDeleteJob`), named for the pages' titles.
- **Corrections:** `patches.json` (RFC 6902, each with its reason and evidence, checked by `scripts/check-sources.ts
  daily` into `sources.json`), applied before the IR: the batch processor's five operations and its job object, which
  the pages document (https://docs.daily.co/reference/rest-api/batch-processor) and the document omits; validating a
  meeting token answers the token's properties; a listed recording carries `room_name`, `duration` and `tracks`; a
  meeting's participants are participant records; `GET /webhooks/:uuid` answers one webhook, not an array.
- **Recordings** (`recordings/`), the live API's answers on 2026-09-28, made with no key or an invalid one (no Daily
  account was used): `GET /v1/rooms` with no `Authorization` header and with `Authorization: Token abc` (400
  `authorization-header-error`, "invalid authorization header"); with `Bearer not-a-key` (401, `{"error":
  "authentication-error"}`, no `info`); `GET /v1/no-such-thing` with and without a key (404 `not-found`, "api endpoint
  does not exist": a path is refused before the key); `GET /v1/batch-processor` with an invalid key (401: the endpoint
  exists though the document omits it).
- **Read by:** `bun scripts/derive-pack.ts daily`, which writes `../src/generated/`.
- **The documentation** is published whole as text (https://docs.daily.co/llms.txt, each page as `<url>.md`), which is
  where this pack's builder read it; the pages cited are the rendered pages themselves.
- **Outside the API:** a Daily account, its domain and its API key are made on the dashboard
  (https://docs.daily.co/docs/rest-api/authentication). No demanded caller requires credential setup or room screens,
  and the pack serves neither. Media and signalling use Daily's call clients (`daily-js`, `https://c.daily.co`),
  outside this REST spec and outside the pack's served surface.
