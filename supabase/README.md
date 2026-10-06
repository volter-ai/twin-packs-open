# @volter/twin-supabase

A local Supabase project's **Postgres database**: in a World it is the World's own managed Postgres, and the twin hands
the application its URL. A Protocol 3 derived pack (twin-world's
architecture, "Protocol 3: the derived pack"); no real Supabase is contacted.

Install the exact twin and World CLI in your app:

```sh
npm install --save-dev --save-exact @volter/world@3.0.92 @volter/twin-supabase@1.0.3
```

Follow [Run a full stack](https://github.com/volter-ai/twin-world/blob/main/docs/guides/run-a-full-stack.md#a-real-database)
to configure the World-owned Postgres and run your migrations and app inside the World. Keep your native Postgres
client unchanged. This release does not implement Supabase's HTTP APIs or make supabase-js calls work.

For an operator calling the server directly:

```sh
bun run src/cli.ts serve --database <postgres url>   # without --database the project has no database to hand out (503)
```

## For whom

RH2 (Volter's product), whose authority store is a Supabase project's Postgres, reached over the Postgres wire alone:
"no PostgREST, no Supabase client library, no anon session" (`journeys/demand.json`). Its release migrates the database
and its Worker queries it; both are answered by Postgres itself, the World's database (`journeys/customer-life.json`
walks RH2's own statements on it).

## What is served

- **The database.** The runtime binds the twin to the World's managed Postgres (`managedDatabase`: `serve --database
  <url>`), and the application connects to that database with any Postgres client. Under the containerless backing its
  clock follows the World clock. Database-generated randomness belongs to the backing and is not pinned; use explicit
  stable fixture IDs when comparing fresh Worlds (twin-world architecture, SQL steps).
- **The door.** `POST /_twin/app-credentials` (the descriptor's `credentialDoor`, called by the runtime at every boot):
  makes the World's project `world` the first time and answers `{ ref, database_url }`, filling `SUPABASE_DB_URL`.
- **Not served** (the gap): every operation of the Management API (`api.supabase.com/v1`), PostgREST (`/rest/v1`),
  Storage (`/storage/v1`) and Auth (`/auth/v1`), each answering its unit's own unknown-route error
  (`journeys/decisions.json`); Realtime and Edge Functions (their paths are not claimed, so the injector refuses them).

## Units

| Unit | Spec | Serves |
|---|---|---|
| `supabase` (`src/`) | `spec/openapi.json.gz`, api.supabase.com's own document (170 operations) | the door; the Management API is the gap |
| `supabase/rest` | `rest/spec/client-ops.json`, the calls `@supabase/postgrest-js` makes | the gap |
| `supabase/storage` | `storage/spec/openapi.json`, storage-api's document as Supabase's docs publish it | the gap |
| `supabase/auth` | `auth/spec/openapi.yaml`, GoTrue v2.197.0's document | the gap |

## Evidence

The vendor's documents and recordings are under each unit's `spec/` (its `SOURCE.md`).
