# A service starts an analytics database

PostHog (source 60dd1fec, demand.json) keeps its analytics in ClickHouse and migrates the schema itself over HTTP.

1. **The operator configures the server.** One local cluster, `posthog`, with its shard and replica macros and
   local replication, through the configuration door.
2. **PostHog connects.** It asks the server whether it is up.
3. **It makes its database and migration tables.** It creates the `analytics` database on its cluster, the
   `migrations` table it records applied migrations in (a ReplicatedMergeTree whose path names ClickHouse's own
   `{database}`, `{table}`, `{replica}` and `{shard}` macros, sent as PostHog writes them), and the distributed table
   in front of it.
4. **It migrates.** As its ORM's `migrate()` does, it reads which of the application's migrations are applied, finds
   none on a fresh database, and records its first migration.
