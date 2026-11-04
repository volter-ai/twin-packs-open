# PlanetScale customer life: outline

Author: Contributor 86

## The customer

**Trailmark** is a two-person startup selling branded short links with a partner (affiliate) program: a customer
workspace owns domains and links, each click on a link is counted, and partners who bring sales earn commissions
that are paid out monthly. Its application runs on Vercel: the redirect edge function and the API routes use
PlanetScale's HTTP driver (`@planetscale/database`) directly, and the dashboard uses Prisma through
`@prisma/adapter-planetscale`, which speaks the same HTTP API. Its data lives in one PlanetScale MySQL database,
`trailmark`, whose production branch is `main`, with safe migrations left off, so the admin password applies schema
changes to `main` directly.

The life spans 2026-01-02 to 2026-06-30: Maya sets the database up, the schema is created, the product launches, the
partner program opens in February, payouts run on the first of each month from March, a schema change lands in April,
the partner program closes with a final payout in late June, and on 06-30 Trailmark shuts down and deletes its database.

## Actors and credentials

| Actor | Acts with | Grant (PlanetScale's words) |
|---|---|---|
| Maya (founder, organization administrator) | the PlanetScale dashboard in her browser: New database, a branch's Connect page (passwords), and the organization's settings page, Service tokens | an administrator makes databases, passwords and tokens, and saves a token's permissions ("you may only add service token accesses that you are also authorized to do") |
| The migration job: a small Node script Maya runs by hand, using `@planetscale/database`'s `execute` | branch password `migrations`, role **admin** | "All read/write permissions and can modify schema" (password roles page); DDL on `main` is allowed because safe migrations are off |
| The migration job's backup step (the same script, before a schema change or a payout run), as Dub's trigger-backup cron | service token `ops` | `write_backups` and `read_backups` on `trailmark`: "Create and update backups", and reading one back to see it finished |
| The application (edge redirect, API routes, Prisma dashboard, payout cron) | branch password `app`, role **readwriter** | "Can query and modify rows" |
| Jon (co-founder, finance) | none of his own: he acts through Trailmark's dashboard, which is the application | |

The application never changes schema; only the migration job does. `ops` only creates and reads backups. Each password's
secret and each token's value is shown once, when it is made, and goes straight into Vercel's environment
(`app`) or Maya's local `.env` (`migrations`, `ops`). No application calls the management API but to back a branch up (Dub's
trigger-backup cron), so the database, its passwords and its deletion are the dashboard's.

## Arc

**1. Setting up (Fri 2026-01-02).** In the dashboard Maya creates the database `trailmark` (cluster size PS_10,
PlanetScale's New database page). On `main`'s Connect page she creates the branch passwords `migrations` (admin) and `app`
(readwriter); each shows its username and password once. On the organization's settings page she creates the service
token `ops` for the migration job's backups, and moves on without saving its permission.

**2. Schema (Mon 2026-01-05).** The migration job, with the admin password, creates the launch tables (`Workspace`,
`User`, `Domain`, `Link` with a unique `(domain, key)` and a click counter, `Tag`, `LinkTag`). The branch is empty,
so there is nothing to back up yet.

**3. Signup (Tue 2026-01-06).** Maya signs up in Trailmark's own app: the dashboard creates her workspace and her user
in one transaction (`BEGIN`, two inserts, `COMMIT`). She adds the domain `go.trailmark.io`; the edge function looks it
up by slug on the first request to it.

**4. First links (Wed 2026-01-07).** Maya creates the launch links (`/pricing`, `/demo`, `/changelog`): for each the
API checks the key is free (`SELECT 1 … LIMIT 1`) and inserts it, then upserts the tag `launch`
(`INSERT … ON DUPLICATE KEY UPDATE`) and links it to the three links in one multi-row insert.

**5. Launch traffic (2026-01-08 to 01-31, sampled).** Each click on a link runs the edge function: it reads the link by
domain and key and increments its clicks (`UPDATE Link SET clicks = clicks + 1 …`), and raises the workspace's usage
counter only while under its plan limit (`UPDATE Workspace SET usage = usage + 1 WHERE … AND usage < usageLimit`).
The life samples launch day and one later day; the dashboard's workspace page reads the workspace with its domains
(`LEFT JOIN`).

**6. The import that collides (Mon 2026-01-19).** Jon imports a CSV of 20 campaign links through the dashboard. Before
he does, he searches the dashboard's links for `spring` (`… WHERE key LIKE 'spring%'`) so as not to make the campaign's
links twice, and finds none. One row's key is `pricing`, which Maya created on 01-07; the multi-row insert fails with MySQL's duplicate-entry error
(1062) and inserts nothing, the dashboard reports the row, and Jon re-imports the other 19.

**7. Partner program (Mon 2026-02-02).** Before changing the schema, the migration job backs up `main` with `ops`.
PlanetScale refuses it 403 Forbidden: `ops` was made in January and its access never saved (the backup operation's
documented refusal). Maya saves its two permissions on `trailmark`, `write_backups` ("Create and update backups") and `read_backups`,
and the job's retry is taken (retention 14 days: long enough to restore if the change goes wrong); two minutes on, it
reads the backup back and sees it succeeded before it touches the schema. The job then creates `PartnerTag`, `ProgramPartnerTag`,
`Partner`, `ProgramEnrollment`, `Commission` and `Payout`. Maya enrolls the first three partners through the dashboard;
each gets a partner link (insert into `Link` with its `partnerId`), and she tags them as she enrolls them: Ana and Ravi
`creator`, Ben `agency`. Two partners set a default payout method (Stripe); the third, Ravi, leaves
it unset.

**8. Sales and commissions (February, sampled).** When a partner's link leads to a sale, the application records a
pending commission. The partner page reads a partner's enrollment with the partner record and the partner's tags, as Dub's own
page does (`LEFT JOIN`s and a derived table gathering the tags with `JSON_ARRAYAGG`).

**9. First payout run (Sun 2026-03-01).** It is the first time Trailmark's code moves money records, so the migration
job backs up `main` with `ops` first (retention 32 days: past the next run on 04-01) and, two minutes on, reads the
backup back and sees it succeeded. The payout cron, per partner with
pending commissions, in one transaction: inserts a pending payout, attaches the commissions to it and marks them
processed (`UPDATE Commission c INNER JOIN Payout p … SET c.status = 'processed', c.payoutId = …`), sets the payout's
amount, and commits. Jon charges the invoice for the payouts of the partners with a payout method; when the charge
succeeds the charged payouts move to `processing` and the cron copies each partner's default payout method onto the
invoice's payouts (`UPDATE Payout p INNER JOIN Partner pn … SET p.method = pn.defaultPayoutMethod`); once the partners'
transfers go out, those payouts are marked `sent` (every later run's invoice ends the same way). Ravi's payout has
no method, so it stays pending and outside the invoice.

**10. A payout paid by hand (Wed 2026-04-01).** Ravi still has no payout method, and his March payout is a month old,
so Jon pays him by bank transfer that morning. The payout run starts at 09:00 and reads every partner's pending
commissions and pending payout. It adds a partner's new commissions to that partner's pending payout if there is one,
and otherwise to a new pending payout: the other two partners' March payouts are `processing` on the charged invoice
and are not touched, so their commissions since March go into new payouts. Before each partner's transaction the run
asks Stripe to price that partner's commissions for the invoice, which takes about a minute a partner, and Ravi comes
last, so the run reaches him at 09:03. At 09:02 Jon marks Ravi's March payout sent in the dashboard. The run's
conditional update of the payout (`… WHERE id = … AND status = 'pending'`) then matches no row, so the run rolls that
partner's transaction back (`ROLLBACK`) and skips him; the other partners' transactions commit. Jon asks Ravi to add a
payout method, and the next day Ravi sets Stripe on his partner page.

**11. Schema change (Mon 2026-04-13).** Links get an `archived` flag. The migration job backs up `main` with `ops`
(retention 14 days), reads it back two minutes on and sees it succeeded, adds the column (`ALTER TABLE Link ADD COLUMN archived …`), and Maya archives the three launch
links in the dashboard.

**12. Quiet months (May to June, sampled).** Clicks continue on the campaign and partner links; the payout runs of
05-01 and 06-01 pay all three partners (Ravi's commissions since March are in the 05-01 run).

**13. Closing the partner program (Mon 2026-06-22).** Trailmark will shut down at the end of June. Jon closes the
partner program: the migration job backs up `main` with `ops` first (retention 1 month: through the program's close), a
final payout run pays every pending commission, and the dashboard marks every enrollment ended.

**13b. The native wire (Wed 2026-06-24, morning).** The redirect service's new release runs on Prisma, which connects
with the database's MySQL connection string (`DATABASE_URL`, MySQL's native wire) instead of the HTTP driver. A
password pasted wrong is refused as MySQL refuses it (1045). With the app password, the release reads the server's
settings as its driver does on connecting, looks a link up by domain and key with a prepared statement, and records a
click's time inside Prisma's transaction: isolation level, `BEGIN`, a bound `UPDATE`, `COMMIT`. The dashboard, still
on `@planetscale/database`, reads the row the release wrote: one database behind both wires. A table the release asks
for before its migration ran is refused as MySQL refuses it (1146), and the release closes its connection.

**14. Leaving (Tue 2026-06-30).** The migration job exports every table (`SELECT *` per table) to Maya's laptop; the
export is what survives. In the dashboard, on the database's settings, Maya deletes it (typing its name to confirm), which removes its branches, passwords, data and backups ("Remove all data and backups
permanently", PlanetScale's delete page). No backup is taken first: the deletion would remove it with the rest.

## Sessions

The life calls neither `CreateSession` nor `CloseSession`. `@planetscale/database` sends every statement to `Execute`,
carrying the session the last answer returned; it reaches `CreateSession` only through `Connection.refresh()`, which
its README does not document (it appears only in the package's type declarations), and it never calls
`CloseSession`. No application of the demand opens or closes a session any other way, so both are the gap: the twin
does not serve them, and no step calls them.

## Demand this covers (Dub run in a World, and Substrate's Prisma client in a tab)

`Execute` (every statement, as Dub's driver, its Prisma clients and Substrate's Prisma client send them: DDL including `ALTER TABLE … ADD COLUMN`, inserts, upserts, multi-row inserts,
conditional and multi-table updates, transactions with commit and rollback, joined reads, a duplicate-key error) and
the management API's `POST …/branches/{branch}/backups` (four backups, each before a change it could undo: two before schema changes, 02-02 and 04-13, and two before payout
runs, 03-01 and 06-22, as Dub's
trigger-backup cron sends it, and its refusal of a token without the access), MySQL's native wire, as Dub's `PrismaClient` sends over `DATABASE_URL` (`apps/web/lib/prisma/index.ts` at
`7e0101363b2ab30afc537c1893f159d1dcba513a`): sign-in, the driver's settings query, prepared statements with bound
parameters and binary rows, and a transaction; plus
the dashboard acts a customer's own setup and departure need: a database created and
deleted, two branch passwords with their roles, and the service token the settings page makes.
