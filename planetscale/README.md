# @volter/twin-planetscale

A local PlanetScale: psdb, the HTTP API that the unmodified `@planetscale/database` and Prisma's
`@prisma/adapter-planetscale` send SQL to (`<region>.connect.psdb.cloud`, this unit). It also serves the dashboard
where a database, its passwords and the organization's service tokens are made (`app.planetscale.com`), and the
management API's branch backups (`api.planetscale.com/v1`), both in the `api/` lane, over one vendor state.

A Protocol 3 pack ([architecture](../../../docs/contributing/architecture.md), "Protocol 3" and "Other wires: lanes").
psdb's surface is its Connect service (`spec/proto`), the management API's its Swagger document (`api/spec`). Handlers
are in `<unit>/src/semantics/<family>.ts`, pages in `api/src/screens`, and state machines in
`api/src/semantics/states.ts`.

```bash
world-planetscale serve [--port N] [--root DIR] [--read-only]
```

## What it models

- **SQL over psdb**: `Execute` runs one statement as MySQL runs it on PlanetScale's Vitess. The semantics are in
  `src/engine`: the parser, exact decimals, temporals and JSON, MySQL 8's collations, the information schema, and
  errno/sqlstate with Vitess's refusal for what it does not model. The answer is psdb's envelope, rows as bytes and
  lengths, with a field at its default value (no rows, a zero rowsAffected or insertId) left out as protobuf's JSON
  mapping leaves it. The journey answer view decodes those cells and rowsAffected as the pinned driver does.
- **Transactions**: a transaction's writes are held in the client's session until COMMIT, and a schema change commits it
  first; a READ ONLY transaction (START TRANSACTION READ ONLY, or SET [SESSION] TRANSACTION READ ONLY) refuses writes.
- **Passwords**: each statement is authorized by the branch password's role (Read-only, Write-only, Read/Write, Admin),
  and refused in PlanetScale's words ("Insert command denied to user … (ACL check error)").
- **State**: tables and rows are the World's, one subject each.
- **The dashboard**: sign-in; New database (ready a minute on); a database's Connect page (a password shown once);
  service tokens (a token shown once) and the permissions saved for them; and a database's deletion, which takes its
  data and backups with it.
- **Backups**: `create_backup` with a service token holding `write_backups` (Dub's trigger-backup cron), retention units
  (a month or year a calendar unit) and value bounds, and the refusal of PostgreSQL-only emergency backups on Vitess/MySQL; running 30
  seconds on and succeeded two minutes on; a token PlanetScale does not know is 401, one without access 403.

## Doors

- `POST /_twin/users/{email} {password, organization}`: a person who signed up, and the organization they administer.
- `POST /_twin/app-credentials {account?, deployment?}`: the application's connection strings, which the runtime
  issues for the organization's deployment database: `PLANETSCALE_DATABASE_URL` for psdb, and `DATABASE_URL` for
  the native MySQL wire at the twin's `mysql` side port.

## The native MySQL wire

The twin serves MySQL's client/server protocol on its `mysql` side port (`--wire-port`), over the same database
psdb serves: a row Prisma writes over `DATABASE_URL` is the row `@planetscale/database` reads. The wire is the kernel's
(`@volter/world-core/mysql`): protocol v10 with `mysql_native_password`, text queries (several per script), prepared
statements with binary rows, and quit. Each statement runs through psdb's engine, session and password roles.

A password signs in with its own secret, checked against MySQL's stored form of it, so the twin never keeps the secret.
A password whose secret the World cannot derive again is refused by name: rotate it on the Connect page.

## Not yet

- psdb's `CreateSession`, `StreamExecute`, `Prepare` and `CloseSession`: the driver sends every statement to `Execute`.
- The rest of the management API (branches, deploy requests, passwords and tokens over the API, backup policies): no
  application calls it.
- Development branches: a password is `main`'s.
- The management API's lists: not served, so a vendor-backed World refreshes nothing; the SQL wire is never sent to the
  vendor (the manifest's `vendorBacked`), the API lane's backups are.
- The native wire's TLS, compression and server-side cursors: the clients the World runs (Prisma's engines) ask for
  none.
