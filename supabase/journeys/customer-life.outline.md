# RH2's authority store on Supabase: the outline

Author: Contributor 173

**Frame.** RH2 is Volter's product; its authority store (its people, organizations, Rooms, Tasks and their history) is
one Postgres database in a Supabase project, and RH2 reaches it over the Postgres wire and nothing else: "no PostgREST,
no Supabase client library, no anon session" (apps/rh2/docs/OPERATIONS.md:255-258, RH2 at 34fdc93). The release's
migrate step (apps/rh2/src/database/migrate-cli.ts, run by apps/rh2/scripts/release.sh:45) lays and advances the schema
on the database's URL; the Worker (apps/rh2/src/edge/database.ts) queries it through Hyperdrive, and the first statement
of each invocation is its readiness inspection. In a World the project's database is the World's managed Postgres, and
the twin hands RH2 its URL. The World clock starts Thursday 1 January 2026.

**Who acts, with what.** Each act is made with the credential named here.

| Who | What they use | Their grant |
|---|---|---|
| RH2's operator | the Supabase dashboard's sign-up and New project (the World's credential door) | makes the project, and is shown its database's URL |
| RH2's operator and release (migrate step) | the database's URL, one connection (`max: 1`, apps/rh2/src/database/pool-options.ts:16) | the database's owner: makes and changes the schema |
| RH2's Worker | the database's URL through Hyperdrive, node-postgres | reads and writes RH2's tables |

## Acts

**1. The project (the World's boot, Thu 2026-01-01).** RH2's operator signs up to Supabase and makes the project that
will hold the authority store; the runtime hands RH2 the project's database URL (`SUPABASE_DB_URL`, the credential
door).

**2. A fresh database (Mon 2026-01-05, 09:00).** Before any release, RH2's Worker asks the database for its readiness in
one statement (schema version, the primary authority's declaration, whether work is admitted). The migration ledger
does not exist, so Postgres refuses with 42P01, which RH2 catches and reads as version 0 (edge/database.ts:324): the
Worker refuses the unmigrated database by name.

**3. The operator's fresh-database command.** The operator runs the migrate step with
`--declare-distributed-authority`, the act its header prescribes for a fresh database (migrate-cli.ts:7-12). It asks whether the ledger exists (it does not), takes the
migration lock, makes the ledger, finds no version applied, and applies the baseline (version 71, the whole schema) and
each migration after it to 106: each in its own transaction, the file sent as one query, recorded with its SHA-256
checksum. It reads the ledger back (36 migrations, each stamped by the database's `clock_timestamp()` at the World's
09:00) and releases the lock. The Task copy finds the cutover already complete on this schema, so there is nothing to
copy. Then, in one transaction under the migration lock, it finds no authority declared and declares the empty
`primary` document as distributed.

**4. Ready.** The Worker's readiness now reads schema 106, the primary authority distributed, and work admitted.

**5. The release (Mon 2026-01-12, 09:00).** The migrate step runs again with no flag, as every release runs it
(release.sh:105): the ledger exists and holds 36 migrations, every checksum matches, nothing is applied, and the ledger
read back is unchanged (still stamped 5 January); the Task copy again has nothing to do. The release
then runs migrate with `--complete-work-cutover` (release.sh:107), after its observation of the
serving work barrier sets `RH2_WORK_BARRIER_CONFIRMED=1` (release.sh:66). It repeats the ledger inspection, migration
lock, ledger reads and Task copy. The completed marker makes `copyTasks` return before its cutover writes
(move-tasks.ts:270), so both migrate runs leave the database unchanged. The Worker's readiness is unchanged.

## What the life does not call

The Management API, PostgREST, Storage and Auth: no demanded application calls them (journeys/demand.json), so each
operation answers its unit's gap (journeys/decisions.json). The schema RH2 lays is its own: nothing of Supabase's
`auth` or `storage` schemas is read or written by RH2.

## Demand this covers

RH2's operator command on a fresh project and the release's two migrate runs on a standing one (the ledger, each
migration as one query in its own transaction,
its checksum recorded, the ledger read back, the Task copy's marker, the authority declaration) and its Worker's
readiness inspection, both before the schema exists (the refusal RH2 catches) and after; and the platform's boot,
which issues the project's database URL through the credential door.
