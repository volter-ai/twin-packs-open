# Tinybird customer life: outline

## The customer

**Loopline** is a two-person startup in Lisbon that gives podcasters branded short links for their show notes and
tells them how many listeners clicked, from where, and from which podcast app. Its product is a fork of Dub's
open-source code (github.com/dubinc/dub, AGPL) at commit `9a30e5942825d73681abd8b5384176c34a0628a5` (Fri 2 January
2026, "remove console log"): a Next.js app on Vercel whose redirect handler records every click, and whose dashboard
shows each podcaster their numbers. Dub's code keeps its analytics in Tinybird, so Loopline does too, and its Tinybird
project is that commit's `packages/tinybird` folder of `.datasource` and `.pipe` files, trimmed to what Loopline uses:
the Endpoints its dashboard reads, and every Data Source and Materialized View Pipe those Endpoints read. Dub's
Endpoints count leads and sales beside clicks, so the lead and sale Data Sources come too; they stay empty, since
Loopline tracks no conversions.

Those datafiles are Tinybird Classic's format, deployed with the Classic CLI, `tinybird-cli`, which Dub's
self-hosting guide installs ("Install the Tinybird CLI with `pip install tinybird-cli`") and Dub's own CI installs the
same way. So Loopline's Workspace is a Classic Workspace. New signups are made in Forward by default, and a Workspace's
creator may still choose Classic: "When you create a new workspace, you'll be given the choice between Classic and
Forward. New signups will be created in Tinybird Forward by default" (changelog, 14 March 2025). The life ends before
Tinybird restricted Classic Workspace creation to Enterprise organizations and set the Classic sunset for Free and
Developer plans (changelog, 17 July 2026).

Where the sources are dated: the Tinybird pages quoted below (plans, limits, tokens, CLI, quarantine) are read as
they stand today (September 2026), after the life. The weekly changelog from January to June 2026 changes none of the
rules the life relies on (the Events API and create-from-schema rates, the 100 MB result length, static tokens and
their refresh, delete by condition, quarantine recovery, Workspace deletion). Two entries touch the life and are
placed by date: on 14 May 2026 Tinybird announced that the Developer plan's billing moves from QPS overages to vCPU
overages, which changes Loopline's invoice and none of its acts, and the cancellation Ines makes in June is the one the
Developer plan page documents; on 22 May 2026 quarantine tables got a
30-day TTL, after February's quarantine was recovered and truncated. The evidence dated inside the life is Dub's commit
above, its self-hosting guide's install line, and the changelogs of March 2025 and May 2026.

Loopline launches with 12 podcasters in January, has 20 by March, loses one in April, and shuts down at the end of
June 2026: its founders are joining a larger podcast network, and its podcasters were told in May to move their links
to Dub's hosted product by 30 June.

The life spans Monday 5 January 2026 to Tuesday 30 June 2026. The Organization `Loopline` holds one Workspace,
`loopline`, in Europe (Frankfurt, GCP europe-west3, API base URL `https://api.tinybird.co`), on the Developer plan at
its smallest size, chosen when Ines signs up ("You select a plan size when signing up or changing plans", Developer
plan page; "Each organization is tied to a single region"). At its busiest Loopline sends a few thousand click events
a day, one Events API request each, well inside "Append data to Data Source using `POST /v0/events`: 100 times per
second" (Limits page), and it creates its ten Data Sources once, inside "Create Data Source from schema: 25 times per
minute".

## The people and programs, and what each acts with

| Actor | Who or what | Credential | Its grant (Tinybird's words) |
|---|---|---|---|
| Ines Duarte | co-founder, engineer; owns the Tinybird account, is the admin of the Organization `Loopline` she creates at sign-up, and the Admin of its Workspace `loopline` | her Tinybird login, in her browser (the sign-up page, the Workspace's Tokens page, Organization settings → Billing) | the Organization's admin, and the Workspace's Admin role: "Manage resources", "Manage users" (Workspaces page) |
| Ines's CLI | `tb` (tinybird-cli 5.22.2, the release `pip install tinybird-cli` installs on 5 January 2026: published 23 December 2025) on her laptop, run in the project folder | the Workspace token `admin ines@loopline.fm`, copied from the Tokens page into `tb auth` | "`admin <your-email> token` for that Workspace that belongs specifically to your user account for CLI usage" (Tokens page, Default Workspace Tokens); its scope is `ADMIN` |
| Ines's CLI, to delete the Workspace | the same `tb`, once, at the end | her `user token`, copied from the Tokens page, passed as `--user_token` | "`user token` for creating new Workspaces or deleting ones where you are an admin" |
| the Loopline app, 5 Jan to 9 Mar | the Vercel app: its redirect handler appends click events, its link API and its cron jobs append link metadata, its dashboard reads Endpoints (Dub's code, through `@chronark/zod-bird` and `fetch`) | `TINYBIRD_API_KEY` = the Workspace's `admin token`, as Dub's self-hosting guide says to set it | `ADMIN`: "All permissions are granted. Do not use this token except in exceptional circumstances." |
| the Loopline app, from 9 Mar | the same app | `TINYBIRD_API_KEY` = `dub_tinybird_token` | the scopes the datafiles grant it: `DATASOURCES:APPEND` on each event Data Source the project pushes (clicks, link metadata, leads, sales: their `TOKEN "dub_tinybird_token" APPEND` lines), and from 9 Mar `PIPES:READ` on each Endpoint the dashboard reads (a `TOKEN "dub_tinybird_token" READ` line Ines adds to each) |
| Rui Matos | co-founder, runs sales and support | none of his own at Tinybird: he reads podcasters' numbers in Loopline's dashboard, which is the app | |
| podcasters | Loopline's customers | Loopline logins; they see their numbers through the dashboard, which is the app | |
| listeners | people clicking links in show notes | none; each click reaches Loopline's redirect handler, which is the app | |

Every token value is shown on the Workspace's Tokens page (or printed by `tb token copy`) and read off it; none is
typed from memory. Nobody makes a JWT: Loopline's dashboard reads Endpoints from its own server.

## The arc

### 1. Signing up (Mon 5 Jan, morning)
Ines signs up at cloud.tinybird.co and creates the Organization `Loopline`, of which she is the admin ("Workspaces are
always created inside Organizations"; "If you don't have an Organization defined, you can also create one in Tinybird
Cloud", Workspaces page), in Europe (Frankfurt), on the Developer plan's smallest size. She creates the Workspace
`loopline` in it and, where the page offers Classic or Forward, chooses Classic (Forward is the default). The
Workspace comes with its default tokens: `admin token`, `admin ines@loopline.fm` and `create datasource token`, beside
her own `user token`. From the Tokens page she copies `admin ines@loopline.fm` into `tb auth` on her laptop, which
checks it against the Workspace and saves it in the project's `.tinyb`, and copies `admin token` into the Vercel
project as `TINYBIRD_API_KEY`, with `TINYBIRD_API_URL` set to `https://api.tinybird.co`, following Dub's self-hosting
guide.

### 2. The first push (Mon 5 Jan, afternoon)
In the project folder Ines runs `tb push --push-deps` ("You can push the whole project … use the `--push-deps` flag",
Data projects page). The CLI resolves which Data Sources each Pipe reads and pushes in dependency order:
- the four event Data Sources `dub_click_events`, `dub_links_metadata`, `dub_lead_events` and `dub_sale_events`;
- the six Materialized View Pipes and the Data Sources they fill: `dub_links_metadata_pipe` →
  `dub_links_metadata_latest`, `dub_click_events_pipe` → `dub_click_events_mv`, `dub_click_events_id_pipe` →
  `dub_click_events_id` (which reads `dub_click_events_mv`), `dub_lead_events_pipe` → `dub_lead_events_mv`,
  `dub_sale_events_pipe` → `dub_sale_events_mv`, and `dub_first_sale_pipe` → `dub_first_sale_mv`;
- the Endpoints `v3_count` and `v3_timeseries` that the dashboard's first version reads. Their clicks node reads
  `dub_click_events_id` when a request names a `customerId` and `dub_click_events_mv` otherwise.

Ten Data Sources in all. The datafiles' `TOKEN "dub_tinybird_token" APPEND` lines make that token and grant it append
on the four event Data Sources ("If the token isn't specified or <token_name> doesn't exist, Tinybird creates it
automatically", Data Source files page); their `TAGS` lines ("Dub Endpoints", "Dub MV Pipes") make those tags and tag
the Pipes. Nothing is ingested yet.

### 3. Launch (Wed 7 Jan)
The first 12 podcasters sign up in Loopline. Each link a podcaster creates is recorded by the link API as a row of
`dub_links_metadata` through the Events API; the Materialized View keeps its latest version in
`dub_links_metadata_latest`. Listeners' clicks start: each click on a link reaches the redirect handler, which appends
one row to `dub_click_events` with `wait=true` ("asks the Events API to wait for acknowledgement that the data you sent
has been committed", Events API page); the Materialized Views roll it into `dub_click_events_mv` and from there into
`dub_click_events_id`. That evening a podcaster opens her dashboard: it reads `v3_count` and `v3_timeseries` for her
Loopline account (its `workspaceId` parameter, Dub's name for a customer account) over the last seven days.

### 4. Traffic (January to June, sampled)
Clicks and dashboard reads go on every day. The life samples a day in each month: clicks on the podcasters' links
that exist that day, links made that day recorded as metadata, and dashboard reads by podcasters Loopline has that day.

### 5. Top sources (Mon 2 Feb)
Podcasters have asked Rui which podcast apps their listeners click from. Ines adds Dub's `v3_group_by` Endpoint to the
project (its `referers` grouping), with the `TAGS "Dub Endpoints"` line it carries, and pushes the new file with
`tb push`. That afternoon the dashboard's new "Top sources" card reads it for the podcasters who open it.

### 6. Clicks in quarantine (Tue 17 Feb to Wed 18 Feb)
Dub's redirect handler sends `qr` as a boolean (`qr: isQr`), which the `qr UInt8` column takes. On Tuesday Loopline
ships a change of its own to the handler that reads the QR flag from the link's query string and sends it on as that
text, `"true"` or `"false"`, which a `UInt8` column cannot hold. From that deploy on every click is written to
`dub_click_events_quarantine` instead of `dub_click_events` (the Events API answers `"quarantined_rows": 1`, which
Dub's code does not check). On Wednesday morning a podcaster writes to Rui that her clicks since yesterday are
missing. Ines queries the quarantine Data Source with the Query API ("The quarantine Data Source is named
`{datasource_name}_quarantine` and can be queried … like a regular Data Source", Recover data from quarantine) and sees
every row's error on `qr`. She reverts the change ("Modify your data producer", the same page) and redeploys. Then she
exports the quarantined clicks with a query that selects the Data Source's own columns, each cast back to its type and
`qr` turned back into a number, and not the quarantine's meta-columns ("you should not use `SELECT *` to recover rows
from quarantine", since it holds "`c__error_column`, `c__error`, `c__import_id`, and `insertion_date`"). She appends
the export to `dub_click_events` with `tb datasource append dub_click_events` (Quick start), and, as the page ends,
truncates the quarantine with `tb datasource truncate dub_click_events_quarantine --yes` ("truncate the quarantine
Data Source to clear out the recovered rows"). She reads `v3_count` for that podcaster to confirm the clicks count.

### 7. Taking the admin token out of the app (Mon 9 Mar)
The `admin token` has sat in the Vercel project's environment since January, readable by every deployment of the
app, and the Tokens page says not to use ADMIN "except in exceptional circumstances", so Ines takes it out. She adds
`TOKEN "dub_tinybird_token" READ` to each of the three Endpoints the dashboard reads ("Grants read access to a Pipe or
Endpoint to the token named <token_name>", Pipe files page) and pushes the changed Pipes with `tb push --only-changes
--force --yes` (the Continuous Integration page's command for a Workspace not connected to Git), which checks each
Endpoint's answers before overriding it. The token now appends to the event Data Sources and reads the three
Endpoints, which is everything the app does. She reads its value with `tb token copy dub_tinybird_token`, sets it as
`TINYBIRD_API_KEY` in Vercel, and redeploys; the next clicks and dashboard reads go through with it.

Then, from her CLI with her `admin ines@loopline.fm` token (scope `ADMIN`), she runs `tb token refresh "admin token"`
("Refresh the Static Token without modifying name, scopes or any other attribute. Specially useful when a Token is
leaked, or when you need to rotate a Token", Token API), so the value that sat in Vercel no longer works. The refresh
invalidates that value and no other: each static token is its own value ("They remain valid until deleted or
refreshed", Tokens page), so `dub_tinybird_token`, `admin ines@loopline.fm` and `create datasource token` keep
working. The `admin token` is the one "used for signing JWTs", and JWTs are signed "with a shared secret between your
app and Tinybird"; Loopline has made no JWT, so none is left unsigned.

### 8. A podcaster leaves and asks to be erased (Mon 13 Apr to Tue 14 Apr)
On Monday the podcast "Deep Current" deletes its Loopline account and asks, under the GDPR, that its data be erased.
Deleting the account runs Dub's workspace-delete cron (`/api/cron/workspaces/delete`), which deletes the account's
links and records each deletion in Tinybird: `bulkDeleteLinks` calls `recordLink(links, { deleted: true })`, which
appends one row per link to `dub_links_metadata` with `deleted` set to 1, through the Events API with
`dub_tinybird_token`; the Materialized View carries them into `dub_links_metadata_latest`.

On Tuesday Ines deletes the account's rows, by its Loopline account's `workspace_id`, from each of the five Data
Sources that hold them, since "Delete operations don't automatically cascade to downstream Materialized Views. You may
need to perform separate delete operations on Materialized Views" (Replace and delete data): `dub_click_events`,
`dub_click_events_mv`, `dub_click_events_id`, `dub_links_metadata` (Monday's `deleted=1` rows with the rest) and
`dub_links_metadata_latest`. Each is `tb datasource delete <name> --sql-condition "workspace_id = '<its id>'" --wait`
(CLI reference: "Deletes rows from a Data Source", "`--wait`: Wait for delete job to finish"), a job the CLI follows
until it is done ("Deletes rows from a Data Source in your account given a SQL condition", Data Sources API). None of
Deep Current's clicks is in quarantine: February's quarantined rows were appended back and the quarantine truncated.
From then on Loopline has 19 podcasters.

### 9. Winding down (May to June, sampled)
Clicks and reads go on at a falling rate through May and June as podcasters move their links to Dub's hosted product.
In April Rust & Repeat files its show-notes link into a folder, Season 3: the link API records the link again with its
folder, and since the workspace now has folders, its host's dashboard reads her week through the folders she may see
(Dub's getFolderIdsToFilter), reading the latest link metadata with FINAL. In May Garden Hours adds a domain of its
own, go.gardenhours.fm, for a festival's printed programme: the link API records the domain's root link, and a
festival-goer types it. Its host reads her week (two clicks), then with the Link type filter on links only (Dub's root
filter), the show-notes link's one; she then tags that link Season 2, which the link API records with its tag.

### 10. Leaving (Tue 30 Jun, evening)
In the evening Loopline turns its app off in Vercel, so no click or read reaches Tinybird after it. Ines exports the
click history for Loopline's records with the Query API, one query per month from January to June (`SELECT * FROM
dub_click_events WHERE toYYYYMM(timestamp) = <month> FORMAT CSVWithNames`). Each month holds at most about 100,000
clicks, some tens of MB as CSV, under "Result length: 100 MB" (Limits page, Query limits). She opens Organization
settings → Billing, which asks her to log in (email, password, and the one-time code MFA mails her) and returns her to
Billing. She deletes the Workspace with `tb workspace delete loopline --user_token <her user token>` ("Deleting a Workspace deletes all
resources within the Workspace, including Data Sources, ingested data, Pipes, and published API Endpoints", Workspaces
page); deleted Workspaces can't be recovered, and the export is what remains. Last, on Billing she cancels the Developer plan (More actions → Cancel plan), and the final invoice is charged ("Remaining
costs are charged automatically upon cancellation", Developer plan page).

## What the life does not do

It never uses Tinybird Forward, Classic Branches or releases (`tb deploy` needs a Workspace connected to Git; Loopline's
is not, so it deploys with `tb push`), connectors, Copy or Sink Pipes, JWTs, or the ClickHouse interface.

## Demand this covers (Dub, run in a World)

The deploys (`tb push`: `POST /v0/sql_tables`, `POST /v0/datasources`, `GET /v0/datasources/{name}`, `POST
/v0/pipes`, `GET /v0/pipes/{pipe}`, the node analysis, `DELETE /v0/pipes/{pipe}` for the check's temporary Pipe,
`GET`/`POST`/`PUT` on `/v0/tags` and `/v0/tokens`, `GET /v0/workspace`), the Events API (`POST /v0/events`), the
Endpoints (`GET /v0/pipes/{name}.json`), the Query API, a Data Source append and a truncate, deletes by condition with
their jobs, a token refresh, and the Workspace's deletion.
