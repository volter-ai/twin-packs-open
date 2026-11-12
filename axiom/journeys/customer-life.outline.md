# Axiom customer life

Author: `Contributor 98`.

Harbourline runs Dub (`dubinc/dub` at `7e0101363b2ab30afc537c1893f159d1dcba513a`) with its Axiom logging on, as the
World bench runs it (twin-world `docs/adr/0036-a-scenario-is-a-timeline-of-inputs.md:190`). Dub's shipped default
sends nothing (`AXIOM_TOKEN` and `AXIOM_DATASET` blank in `apps/web/.env.example:140–141`; ConsoleTransport without
them, `apps/web/lib/axiom/server.ts:15,29–40`); the bench sets both from the World's credential door. Every batch goes
through `@axiomhq/logging` 0.1.5's AxiomJSTransport and `@axiomhq/js` 1.3.1 to the legacy ingest, `POST
https://api.axiom.co/v1/datasets/<AXIOM_DATASET>/ingest`, as NDJSON with `Authorization: Bearer <AXIOM_TOKEN>`
(`client.js:41–51,199–205`). The SDK reads nothing of a success; a 4xx's `message` is its error (`fetchClient.js:33–39`).

1. **Sign-up (Tuesday 6 January, 09:00).** The World's door (`/_twin/app-credentials`) makes the `logs` dataset and a
   basic API token that ingests into it (Axiom's console: a new dataset, Settings > API tokens). Asserts the token's
   `xaat-` form and the dataset's name; both are captured for every later act.
2. **A route's request line.** Dub's Resend webhook route, wrapped by `withAxiom` (`@axiomhq/nextjs` 0.1.6
   `transformRouteHandlerSuccessResult`), logs its method, path, status and duration with the request fields at the
   event's root, and flushes: one NDJSON line. Asserts `ingested` 1, `failed` 0, empty `failures`.
3. **A job's two lines (09:05).** The jobs route logs `jobs.invalid_envelope` at error
   (`apps/web/app/api/jobs/process/[jobName]/route.ts:38`) and its request line; one batch of two. Asserts `ingested` 2.
4. **A thrown render (09:10).** `onRequestError` (`apps/web/instrumentation.ts:2`; `transformOnRequestError`) logs
   the error's message with its name, stack, digest and route context. Asserts `ingested` 1.
5. **Restart (Wednesday 7 January, 08:00).** The World boots again and its door answers the same token and dataset
   (the credential door runs at every boot). Asserts both equal the captured values.
6. **Read-back.** The bench, as a vendor-backed root, lists the account's datasets (`getDatasets`, the dataset's
   refresh). Asserts the dataset's `id` and `name` are the captured dataset, with `who` and `created`.
7. **Clock skew.** A host two days ahead sends one valid and one future line: the valid one is stored, the other is
   counted in `failed` and listed in `failures`. A batch of only far-future lines is refused whole (400). The
   operator corrects the clock (08:10) and the next batch is ingested whole.
8. **Misconfiguration.** A deployment with no token is refused 401 `Unauthorized`; one whose `AXIOM_DATASET` names a
   dataset the account lacks is refused 404 `Dataset not found`.

Each accepted line is kept as an `event` under its dataset (`_time`, `_sysTime`, `_rowId`, `data`), the World's
history that the bench's evidence adapter reads as log records. No act queries Axiom: no demanded caller or the bench
does, so the query operations stay the gap. A token whose access excludes a dataset (403) needs a second dataset,
which only `createDataset` (the gap) makes; the refusal is served and no act walks it.
