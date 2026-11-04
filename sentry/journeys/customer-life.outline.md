# sentry customer life: outline

Author: Contributor 93

## The customer

**Harbourline** runs Rallly (lukevella/rallly at `3e63239dbdec`) and Twenty (twentyhq/twenty at `1d561b8c73c9`) for its team,
and Scheduler for its social channels, each reporting to Sentry (../journeys/demand.json):

- **Rallly**: `@sentry/nextjs` 10.38 on the server, edge and browser (errors, transactions, logs, Session Replay; the
  browser envelopes directly to its DSN host (tunnelRoute is commented out)), and at build `withSentryConfig`, whose sentry-cli makes the release,
  uploads the source maps in chunks, assembles them into an artifact bundle and finalizes the release.
- **Twenty**: `@sentry/nestjs` 10.73 on the server (errors, transactions, profiles), its cron jobs checked in as
  monitors (`captureCheckIn` with the schedule).

Harbourline also runs Cal.com (calcom/cal.diy at `54343aa685ae`) for bookings. Its release script reads SENTRY_AUTH_TOKEN, makes its git HEAD release, associates local commits, injects source-map debug ids, uploads the bundle and finalizes. Scheduler pins Sentry 10.56.0.

The World clock starts 2026-01-01.

## People and programs

| who | holds | how |
|---|---|---|
| Priya Raman, Harbourline's engineer | the harbourline organization | bootstrap sign-up; additional projects and keys through the API; token issuance door |
| Rallly and Cal builds | the bootstrap token and Cal CI token | sentry-cli 2.58.4 |
| Rallly, Twenty and Scheduler in production | their projects' DSNs | the SDKs' envelopes |

## The arc

### 1. Setting up (Mon 5 Jan)
The bootstrap makes the organization, first auth token and rallly project/DSN. Priya issues Cal's CI auth token for SENTRY_AUTH_TOKEN. With her bootstrap token she creates twenty and scheduler through createOrganizationProject, and reads their DSNs through listProjectKeys. She creates cal for the booking app.

### 2. Rallly's release (Tue 6 Jan, 10:00)
sentry-cli makes `rallly@4.2.0` (a retry answers 208), reads the chunk
options, finds its chunk missing, uploads it gzipped by its SHA-1, assembles the bundle (created, then ok), and
finalizes the release. 

### 3. Production (Tue 6 Jan, 14:30)
A browser session; an unhandled rejection with its stack trace, and the same error for another visitor in a gzipped
envelope (one issue, two users); a transaction; a replay of the visitor who hit
the error; a Scheduler user sends feedback from its configured widget; Scheduler's post_created metric; the server's logs and minute of HTTP request-session aggregates; a client report for sampled-out transactions.

### 4. Twenty's cron (Wed 7 Jan, 03:00)
The cleanup job checks in in progress with its schedule (the monitor is made), then ok using the same check-in id and no explicit duration (checkin_margin 1, max_runtime 5); a worker
error through its configured exception handler. A sampled cleanup transaction carries its CPU profile. The next night's cleanup reports in_progress and error on the next night.

### 5. The next release (Mon 2 Feb)
Cal's full 40-hex git HEAD release; its shipped script uses `set-commits --auto --ignore-missing` and finds no repository. It reads the preceding release (200 {}, as none has commits) and attaches local git commits. Its source maps, after local debug-ID injection, are uploaded through chunk options, missing-chunk assembly, gzip upload, and assembly polling. Then the release is finalized.

## What the life does not do
Every other API operation (`unmodeled`); a repository's integration; symbolication with the uploaded source maps.
