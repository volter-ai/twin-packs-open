# @volter/twin-tinybird

The Protocol 3 twin of **Tinybird Classic**: the API at `api.tinybird.co` and every region's `api.<region>.tinybird.co`,
and the console at `cloud.tinybird.co`. Its surface is tinybird-cli 6.5.5's requests (`spec/client-ops.json`,
provenance in `spec/SOURCE.md`); what it serves and why is `journeys/decisions.json`; how a pack is built is twin-world's
`docs/contributing/architecture.md`, "Creating a pack".

```bash
bunx @volter/twin-tinybird serve
```

## For whom

- **Dub** (`journeys/demand.json`): its click, link, lead, sale, webhook, postback, audit, API-log and import-error
  events through the Events API (`POST /v0/events`, `wait=true`), its analytics read from published Endpoints as JSON
  (`GET /v0/pipes/<pipe>.json`), and the rows its reattribute-customer workflow deletes by condition
  (`POST /v0/datasources/<name>/delete`), through `@chronark/zod-bird` and `fetch`.
- **A Classic Workspace's owner** deploying Dub's datafiles with tinybird-cli (`journeys/customer-life.json`): `tb auth`,
  `tb push` (Data Sources from their schemas, Pipes from full JSON with their Materialized Views and Endpoints, the
  datafiles' TOKEN and TAGS lines, a forced push's regression check over `tinybird.pipe_stats_rt`), the Query API in JSON,
  CSVWithNames and JSONEachRow, a quarantine recovered with `tb datasource append` and truncated, deletes by condition and their
  jobs, a Static Token refreshed, and the Workspace deleted with a user token.

## What it serves

Data Sources with real quarantine of the rows their schema cannot hold; Pipes whose SQL and template run on the
kernel's ClickHouse engine (`@volter/world-core`'s `clickhouse`), Materialized Views fired on every insert; CSV and NDJSON Endpoints with optional CSV headers; Pipes created from full JSON, one SQL or another Pipe; individual JSON events; Static
Tokens and their scopes and SQL row filters, token renaming, CSV/NDJSON imports from files or World-held URLs in create, append and replace modes; tags; import and delete jobs. Each request is gated by its token. Every subject is stored as the API answers it, so a
World rooted at a Tinybird account refreshes the Workspace, its Data Sources, Pipes, tokens, tags and jobs into it
(`src/manifest.ts`, each resource's `refresh`); a Data Source's rows have no id at Tinybird and are never read back.

## Doors and pages

- `GET /_twin/mailbox/{email}`: the World's stand-in for a person's inbox, where the console's one-time log-in code
  arrives.
- `POST /_twin/app-credentials {account?, deployment?}`: the runtime's credential door, issuing an application's
  `TINYBIRD_API_KEY` (the admin token of the deployment's Workspace inside its World organization).
- The console's pages (`src/screens/console.tsx`): sign-up and log-in, the Organization, Create Workspace (Classic),
  the Workspace's Tokens page, and Organization settings → Billing (billing details, a Developer plan, its
  cancellation).

## Left out

The CLI library's rendered-SQL doctests have no served vendor HTTP path that returns their local computation.
They remain published examples in `spec/doc-examples.json`, counted as unserved client computations.

Every operation of the surface no demand, life step or refresh reaches answers the vendor's unknown-request refusal
(the manifest's `gap`), and so does a documented variant of a served one that none asks for: JWTs, Copy and Sink Pipes, Endpoints in
Parquet or Prometheus and SQL over an Endpoint, the Query API's POST forms and its other formats, Service Data Sources
other than `tinybird.pipe_stats_rt`, Parquet imports and managed connector flows, jobs' filters, connectors, Branches and releases, and Tinybird Forward. The ClickHouse interface's and
the MCP server's hosts are not claimed.
