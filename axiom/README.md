# @volter/twin-axiom

Protocol 3 twin of the Axiom Public API, for the logs an application ships with `@axiomhq/js`.

**Served.** The legacy ingest, `POST /v1/datasets/{dataset_name}/ingest` (also under `cloud.axiom.co/api`), which
`@axiomhq/js` 1.3.1 sends every batch to: JSON, NDJSON and CSV bodies; `timestamp-field`, `timestamp-format` (Go's
reference layout) and `csv-delimiter`; `X-Axiom-CSV-Fields` and `X-Axiom-Event-Labels`; gzip, zstd, br and deflate
bodies; reserved field names renamed `_user_<name>`; the field-size and nesting limits; events more than 24 hours
ahead or before the epoch counted in `failures` (a request of only those refused 400). Each accepted event is kept as
the vendor's record, `event`, as the legacy query answers an entry: `_time`, `_sysTime`, `_rowId` and `data` (the
event's fields), under its dataset. The dataset list, `GET /v1/datasets`, which a vendor-backed root refreshes the
account's datasets by.

**For whom.** Dub's logger (`@axiomhq/logging` over `@axiomhq/js`, `apps/web/lib/axiom/server.ts`) as the World bench
runs it, whose evidence reads the stored events as log records (twin-world ADR 0036). Dub and Cal send nothing as
they ship: both leave `AXIOM_TOKEN` and `AXIOM_DATASET` blank (`journeys/demand.json`, `optional`).

**Doors.** `POST /_twin/app-credentials`: the account's sign-up, the `logs` dataset and a basic API token
(`xaat-…`) that ingests into it, the same at every boot; it fills `AXIOM_TOKEN` and `AXIOM_DATASET`.

**Left out.** Every other operation answers Axiom's 404: creating, updating, trimming and deleting datasets, the
queries (APL and legacy), the current user, and the edge ingest (`/v1/ingest/<dataset>` on an edge domain), which no
pinned client sends to. With no query served, an ingested event is read only from the World's history; its
`refresh` is none for that reason.

`spec/SOURCE.md` records the unchanged upstream document, its hash and the error-schema corrections.
