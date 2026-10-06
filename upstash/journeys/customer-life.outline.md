# Upstash — customer life outline

Author: Contributor 85 (the upstash pack builder).

## The customer

**Ember Street** is a four-person product studio, two founders in Portland and two in Lisbon, that runs two small
products on one Upstash account:

- **Kiln** sells seats in pottery classes run by independent studios. Its site is a Next.js app on Vercel. It keeps no
  relational database in its first quarter: each pottery studio keeps its class schedule and its bookings in its own tab
  of a Google Sheet, which Kiln's scripts and nightly job read and write. Upstash Redis holds everything the site needs
  fast or atomically: each class session's seat count, the catalogue cache, the booking rate limit, a set of disposable
  email domains it refuses, a stream of booking events for the nightly job, a per-class waitlist, and a popularity score
  per pottery studio. Six pottery studios launch with Kiln: Terra, Earthwork, Wheelhouse, Slip & Glaze, Mudroom and
  Firefly. Two more, Clayground and Hollow Pot, join on Monday 2 February.
- **Looplinks** sells short links with a partner program: a brand on Looplinks invites partners (creators,
  newsletters), gives each a tracked link, and pays them a commission on the sales their links bring. Its app is Dub's,
  a Next.js app on Vercel with a Postgres database. It uses QStash for background jobs and for the monthly payout run,
  and Upstash Workflow for the two multi-step processes that must survive a failed step: a partner's onboarding once a
  brand approves them, and the recording of a commission when a sale comes in. The first brand is **Fernwood Coffee**, a
  roaster in Porto, which signs up on Tuesday 6 January and approves its first four partners on Thursday 8 January. A
  second brand, **Kettle & Pine**, signs up on Wednesday 14 January and deletes its account two days later.

The story runs from Monday 5 January 2026 to Wednesday 1 April 2026: Redis on the free plan (256 MB of data and 500K
commands a month, upstash.com/docs/redis/overall/pricing), of which Kiln sends a few thousand commands a day at its
busiest; QStash on Pay as You Go (https://upstash.com/pricing/qstash: messages unlimited, max delay 1 year, logs kept 7
days, DLQ kept 7 days), of which Looplinks sends a few hundred messages a month.

## The people and programs, and what each acts with

| Actor | Who or what | Credential | Its grant |
|---|---|---|---|
| Priya Nair | co-founder, in Portland; owns the studio's Upstash account | her Upstash console login (priya@emberstreet.co and a password) | the console: its Redis pages, where she creates Kiln's database, reads its endpoint and tokens, and deletes it; its QStash page, whose Quickstart shows `QSTASH_URL`, `QSTASH_TOKEN` and the two signing keys, with "Reset token" (https://upstash.com/docs/qstash/howto/reset-token) and "Roll keys" |
| the Kiln site | Kiln's Next.js app on Vercel, using `@upstash/redis` and `@upstash/ratelimit` | the database's Standard REST token, as `UPSTASH_REDIS_REST_TOKEN` in Kiln's Vercel project | "Standard token has full privilege over the database, can execute any command" (restapi page) |
| Kiln's nightly job | a Vercel cron route of the same app, declared in its `vercel.json` with the schedule `0 10 * * *` (UTC): 02:00 PST, and 03:00 PDT from 8 March | the same Standard token, from the same environment | the same |
| Tomás Reyes | co-founder, in Portland, runs Kiln: its scripts from his laptop (the monthly schedule load, corrections, housekeeping, the export) | the same Standard token, from Kiln's `.env.local` | the same |
| the Looplinks app | Looplinks' Next.js app on Vercel: its server code calls QStash through `@upstash/qstash` (jobs, the payout run) and `@upstash/workflow`'s `Client` (triggers); its monthly payout route is a Vercel cron (`vercel.json`, `0 8 1 * *`, as Dub's crons are) | `QSTASH_TOKEN` in Looplinks' Vercel project | the token "is used to interact with the QStash API. You need it to publish messages as well as create, read, update or delete other resources" (reset-token page): every API call |
| the Looplinks routes QStash calls | `/api/jobs/process/<job>`, `/api/cron/payouts/send-stripe-payout`, `/api/cron/send-batch-email`, `/api/cron/qstash-failure`, and the two workflow routes (`/api/workflows/partner-approved`, `/api/workflows/create-partner-commission`), each `serve()` or a route that verifies `Upstash-Signature` | `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` in Looplinks' Vercel project; a workflow route's step calls go out with `QSTASH_TOKEN` | verifying with both keys (https://upstash.com/docs/qstash/howto/roll-signing-keys: "you should always try to verify with both keys"); the token as above |
| Maya Costa | co-founder, in Lisbon, runs Looplinks; her scripts use `@upstash/qstash` and `@upstash/workflow` from her laptop | the QStash token, from the studio's password vault | every API call |
| Sam Duarte | engineer on Looplinks, in Lisbon; joins Monday 2 February and takes Looplinks' on-call pager | the QStash token, from the vault, through a small ops script on his laptop | every API call |
| Upstash | QStash delivering each message and each workflow step to Looplinks' routes, retrying, keeping the DLQ | — | its own |

Every call to the database is Upstash's REST API at the REST URL the database was given: the site and the job go through
`@upstash/redis`, which batches the commands it is given into `POST /pipeline` (auto-pipelining, its default) and sends
a script as EVAL or EVALSHA; Tomás's scripts use the same client. Every QStash call is its REST API at
`https://qstash-us-east-1.upstash.io` (the region Priya picks for Looplinks, whose users are in Europe and the US east).
Nobody uses a Read Only token. Only Priya signs in to the console: the database and QStash are made, their credentials
read, and QStash's token reset and keys rolled there, as the applications this story stands for make theirs (none of
them calls the Developer API); she hands each product's credentials to its team through the studio's vault.

## The arc

Kiln's acts are in Portland time (PST, PDT from Sunday 8 March); Looplinks' are in UTC (Lisbon's time until 29 March).

### 1. Signup (Mon 5 Jan, 09:00 PST)
Tomás checks the new Redis REST endpoint by hand before configuring the client. A mistyped SETT is refused as an
unsupported command ([REST HTTP codes](https://upstash.com/docs/redis/features/restapi)); the client then sends SET.
Priya has signed up for Upstash with her email. She logs in to the console, opens Redis and creates a database: name
`kiln-prod`, primary region `us-west-1` (AWS), the free plan (upstash.com/docs/redis/overall/getstarted: "Create
Database"). The database's page shows its REST endpoint and its tokens; she copies `https://<endpoint>.upstash.io` and the
Standard token into Kiln's Vercel project as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. She then opens
QStash, picks the `us-east-1` region, and copies `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and
`QSTASH_NEXT_SIGNING_KEY` from its Quickstart into Looplinks' Vercel project and the vault.

### Kiln

#### K1. The first deploy (Mon 5 Jan, afternoon)
Tomás runs the seed script from his laptop. It loads the list of disposable email domains Kiln refuses at signup (about
forty, from a public list) into a set, `blocked:email-domains`.

#### K2. The monthly schedule load (Mon 5 Jan, then the 1st of each month)
Tomás's load script reads every pottery studio's tab of the sheet and writes that month's class sessions, each as a hash,
`session:<id>`: the class title, the pottery studio, the start time, capacity and seats booked (0). It reaches the
pottery studios Kiln has on the day it runs:
- Mon 5 Jan: the six launch studios' January sessions.
- Sun 1 Feb: the same six studios' February sessions. Clayground and Hollow Pot join the next day (K9), and their
  February sessions are loaded when they join.
- Sun 1 Mar: all eight studios' March sessions, after the morning's housekeeping (K10).

#### K3. The catalogue cache (from Tue 6 Jan)
On each request for the class list, the site reads the hash `catalog`. On a miss it rebuilds it studio by studio, one
field per pottery studio from that studio's tab (six writes, eight from February), into `catalog:next`, and swaps it in
with RENAME, so no visitor reads a catalogue built halfway; it then sets a five-minute expiry on `catalog`. The first
visitor of the morning misses; the next ones hit. Later in the day the cache has expired and the next visitor rebuilds
it.

#### K4. Signups (Tue 6 Jan onward)
When a customer signs up, the site checks the email's domain against `blocked:email-domains` (SISMEMBER). One signup
from a disposable domain is refused. When Tomás bulk-imports Earthwork's existing mailing list (Thu 8 Jan), the import
checks all of that list's domains in one call (SMISMEMBER) and skips the two that are blocked.

#### K5. Booking a seat (from Wed 7 Jan, through March)
The booking API is rate-limited per IP with `@upstash/ratelimit`, a sliding window of 5 requests per 10 seconds. The
limiter tries its script by SHA first and, finding it not cached, sends it with EVAL; later calls run it by SHA.

A booking runs one Lua script with EVAL: it reads the session's capacity and seats booked, and if a seat is left it
increments seats booked and returns the new count; if not, it returns -1. The site then records the booking in the
`bookings` stream (XADD, with type `booking`, the session, the customer's email and the amount) and adds one to the
pottery studio's score in `popular:studios` (ZINCRBY). The score counts bookings made: a refund or a cancellation does
not take one back. Bookings go on through February and March, into each month's sessions.

On Sat 10 Jan a customer, Mei, double-clicks "Book": her second request lands inside the same second and the limiter
allows it (2 of 5), so she books two seats. She writes in; Tomás refunds one by hand in Stripe, lowers the session's
seats booked by one with HINCRBY from his laptop, and adds a `refund` entry to the `bookings` stream so the studio's
tab shows it.

On Thu 15 Jan a bot hammers the booking API from one address: the sixth request inside ten seconds is refused by the
limiter (the script answers that the window is full) and the site answers 429.

#### K6. A full class and its waitlist (Sat 17 Jan)
Terra's wheel-throwing session on 24 January fills. The script answers -1 for the next booking; the site offers the
waitlist and appends the customer's email to `waitlist:<session>` (RPUSH). Two more join that day. On Tue 20 Jan a
booked customer cancels: the site lowers seats booked by one, adds a `cancel` entry to the `bookings` stream, pops the
first waitlisted email (LPOP), and emails her a link; she books the freed seat.

#### K7. The nightly job (every night at 10:00 UTC: 02:00 PST, 03:00 PDT from Sun 8 Mar)
The job first takes a lock, `lock:nightly` (SET with NX and a ten-minute expiry, as Dub's crons lock), so a run Vercel
delivers twice never writes the sheet twice: on Fri 6 Feb Vercel calls the route twice a second apart, the second call
finds the lock held (SET answers null) and exits. The job then reads the `bookings` stream from after the last id it
processed (XRANGE with an exclusive start), writes those entries (bookings, refunds and cancellations) to each studio's
tab, stores the last id it wrote in `bookings:cursor` (SET), and deletes the entries it has written from the stream
(XDEL). A night with no new entries reads nothing and changes nothing. So the stream holds only the day's entries not
yet written to the sheet, and the admin page's "Today" panel shows the ten most recent of them (XREVRANGE with COUNT
10), newest first.

#### K8. Page views (throughout)
Each class page view adds one to `views:<session>` (INCR); the admin page reads a session's views with GET.

#### K9. New pottery studios and the popularity strip (Mon 2 Feb)
Clayground and Hollow Pot join. Tomás's load script writes their February sessions. The home page now shows the three
most popular studios: `ZRANGE popular:studios 0 2 REV WITHSCORES`.

#### K10. Housekeeping (Sun 1 Mar, morning)
January's and February's sessions are over. Tomás's script walks `session:*` with SCAN, reads each session's start
time (HGET), and deletes every session that started before 1 March with its waitlist and view counter (DEL). It also
removes one domain from the blocked set that a customer showed is a real university's (SREM). The March load (K2) runs
after it.

### Looplinks

#### L1. Brands sign up (Tue 6 Jan, Wed 14 Jan, Fri 16 Jan)
When a brand's owner signs up, the app publishes two messages, each labelled with the account (`Upstash-Label`): the
welcome job at once (`/api/jobs/process/welcome-user-job`) and the onboarding-tips job delayed 7 days (`Upstash-Delay:
604800s`, as Dub's `dispatchJobs` sends it). QStash delivers the welcome job to the route, which checks the signature,
sends the email and answers 200.
- Fernwood's owner signs up on Tue 6 Jan; Maya's script reads the tips message (`messages.get`) and sees it waiting for
  Tue 13 Jan, when it reaches the route.
- Kettle & Pine's owner signs up on Wed 14 Jan and deletes the account on Fri 16 Jan. Deleting it cancels every message
  still waiting with the account's label (`messages.cancel({ filter: { label } })`, `DELETE /v2/messages`): the tips
  message for Wed 21 Jan, so no email goes to an account that is gone. Maya's script reads the tips message
  again and finds QStash no longer holds it.

#### L2. Fernwood approves its first partners (Thu 8 Jan)
On Wed 7 Jan Fernwood's developer adds a webhook endpoint in Looplinks' settings, `https://fernwood.coffee/hooks/looplinks`,
subscribed to `partner.enrolled`. On Thu 8 Jan Fernwood approves four partners: Ana, Bruno, Carla and Diogo. The app
triggers one `partner-approved` workflow run per partner in one call (`client.trigger([...])`, a batch), each with the run
id the app's job row gives it, `retries: 5` and the flow control key `partner-approved` with parallelism 15, as Dub's
`triggerWorkflows` sends them. Each run is QStash calling the workflow route once per step, and the route answering by
sending the step's result back as the next call (https://upstash.com/docs/workflow/basics/how), `context.run` steps only,
as Dub's are:
1. `create-default-links`: the partner's tracked link.
2. `send-email`: the welcome email with the link.
3. `send-webhook`: `partner.enrolled` to Fernwood's webhook.
Then the route function returns and `serve()` ends the run (`DELETE /v2/workflows/runs/<id>`).

#### L3. Commissions (Tue 13 Jan onward)
Each sale through a partner's link triggers a `create-partner-commission` run (retries 5). Its steps: `create-commission`
(the commission row), `run-side-effects` (the partner's earnings total), and, when the partner has an active bounty,
`set-bounty-commission`. Its `failureFunction` pages whoever is on call. Sales: Ana on Tue 13 Jan and Tue 27 Jan, Bruno on
Thu 29 Jan, Ana on Thu 12 Feb (L6), Bruno on Thu 19 Feb.

#### L4. The monthly payout run (Sun 1 Feb, Sun 1 Mar, 08:00 UTC)
Vercel's cron calls the payout route. It reads last month's unpaid commissions and makes sure the payout queue exists with
parallelism 1 (`queue.upsert({ parallelism: 1 })`), so payouts go one at a time in order
(https://upstash.com/docs/qstash/features/queues). For each partner with any, it enqueues one payout job into
`send-stripe-payout` (`/api/cron/payouts/send-stripe-payout`), deduplicated by the payout's id (`Upstash-Deduplication-Id`,
as Dub's payout jobs are) and with `Upstash-Failure-Callback` set to `/api/cron/qstash-failure`; it then sends the paid
partners their monthly summaries as one message into the `send-batch-email` queue (`/api/cron/send-batch-email`, as Dub's
`queueBatchEmail` does), deduplicated by the month. Each payout job transfers the partner's commissions from Looplinks'
own Stripe balance, which Looplinks tops up from the brands' monthly fees.
- Sun 1 Feb: Vercel delivers the cron twice a few seconds apart ("Vercel's event-driven system can occasionally deliver
  the same cron event more than once"). The second run's enqueues carry the same deduplication ids and QStash accepts
  them without making new messages, so Ana (two sales) and Bruno (one) are each paid once; both jobs are delivered and
  answered 200, and the summaries go out once.
- Sun 1 Mar is L7.

#### L5. The contractor leaves (Fri 30 Jan)
The contractor who built Looplinks' partner pages had the QStash token and both signing keys in his laptop's
`.env.local`. Signatures are HMAC over a shared key, so whoever holds a key the app verifies with can forge a delivery.
His last day is Friday; on Thursday evening in Portland (06:30 on Friday in Lisbon, before Looplinks' first signup or
sale of the day) Priya resets the token in the console, and Maya, up early in Lisbon, puts the new token in Looplinks'
Vercel project and the vault and redeploys at once; nothing publishes between the reset and the live deploy.

One roll is not enough: it makes the next key, which he holds, the current one ("currentKey = nextKey", with a new next
key made, https://upstash.com/docs/qstash/howto/roll-signing-keys). So Priya rolls twice in the console (QStash, Signing
Keys, Roll keys), with Maya updating the app in between, as the page's warning requires ("Rolling your keys twice
without updating your applications will cause your apps to reject all requests, because both the current and next keys
will have been replaced."):
1. Priya rolls; Maya sets `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` from the page and redeploys. Until
   that deploy is live, deliveries are signed with the old next key, which the running app verifies with.
2. Once that deploy is live, Priya rolls again; Maya sets the new pair and redeploys.
After the second roll neither key the contractor held is current or next.

#### L6. A step that fails every time (Thu 12 Feb to Mon 16 Feb)
Fernwood launched a bounty on Tue 10 Feb. Ana's sale on Thu 12 Feb at 15:00 UTC is the first commission of a partner with
an active bounty, and `set-bounty-commission` throws on a bounty with no end date: the route answers 500. QStash retries the
step on its backoff, `min(86400, e^(2.5n))` seconds: 12s, 2m28s, 30m8s, 6h7m6s, then a day
(https://upstash.com/docs/qstash/features/retry); each attempt fails the same way. After the fifth retry, on Fri 13 Feb at
about 21:40 UTC, the run has failed: QStash calls the `failureFunction`, which pages Sam. On Mon 16 Feb Sam ships the fix to
that step and triggers the commission's run again for Ana's sale; its steps run and it finishes. Bruno's sale on Thu 19 Feb
runs all three steps without a failure.

#### L7. Stripe is down during the payout run (Sun 1 Mar)
Stripe's API fails from 07:50 to 10:30 UTC. At 08:00 the payout route enqueues Ana's and Bruno's payouts. Ana's job answers
500; QStash retries it three times (the default) on the backoff and, about 33 minutes later, it has failed: it is in the DLQ
and QStash calls the failure callback, which pages Sam. Bruno's job, next in the queue, then fails the same way and pages
Sam again at about 09:06. At 10:45, with Stripe back, Sam runs the payout route's enqueue again from his script with fresh
deduplication ids (the old ids name messages QStash still holds); both are delivered and answered 200. The summaries' batch
had gone out at 08:00, so Ana and Bruno were told they were paid almost three hours before the money moved: a known wart
Looplinks leaves as it is.

### 2. Leaving (Tue 31 Mar and Wed 1 Apr)
At the end of the quarter the studio sells Looplinks to a larger company, whose own queue its jobs move to, and moves
Kiln to a Postgres database with a queue of its own, in a new Vercel project.
- Looplinks (Tue 31 Mar, 15:00 UTC, 08:00 PDT): its Vercel crons are removed, and once the acquirer's dry run passes
  Priya resets the QStash token in the console, so no old deploy can publish again; a stale preview deploy's next publish
  is refused (401). The account keeps its QStash and what it holds.
- Kiln (Tue 31 Mar, 13:00 PDT): Tomás's script exports what is left. It reads the keys Kiln names itself by name: the
  blocked domains (SMEMBERS), the pottery studios' scores (ZRANGE WITHSCORES), the bookings stream (XRANGE, empty since
  the last night's run) and the job's cursor (GET). It finds the keys Kiln makes per session by their patterns with SCAN
  (`session:*`, `views:*`, `waitlist:*`) and reads each one found (HGETALL, GET); no waitlist is left. It writes them all
  to a file. At 14:00 Priya deletes `kiln-prod` in the console, on the database's page (Delete, confirmed by typing its
  name).
- The last cron (Wed 1 Apr, 10:00 UTC, 03:00 PDT): Kiln's old project's `vercel.json` still declares the nightly cron, so
  it fires. Its first call to the database is refused (401, the token is gone with the database) and the job fails. Tomás
  sees the failure that morning and removes the cron from the old project's `vercel.json`.

## The author's walk

- Every console act (the database's create, its page and its delete; QStash's opening, its token resets and key rolls)
  is Priya's, with her login, at a time she is awake in Portland. Every act on Kiln's data is by the site, the nightly job
  or Tomás with the Standard token, whose grant is every command. Every QStash call is by Looplinks' app, its routes'
  `serve()`, or Maya's and Sam's scripts with the one full-access token; the reset of L5 replaces it in every place the
  story uses it and is live before anything publishes, and the reset of the leaving is QStash's last act. The contractor
  held the token and keys but never acts; his leaving is why L5 resets and rolls them. Looplinks' routes verify with both
  signing keys; each roll comes with a redeploy, so at every moment the key QStash signs with is one the live app holds.
- Causes carried out, Kiln: the blocked set loaded in K1 is read in K4 and edited in K10; the monthly loads of K2 write
  the sessions every booking of K5 and K6 moves, and the March load's sessions, moved by March's bookings, are read by the
  export; the double booking's cause (the limiter allows two in a window) is the limit set in K5; the refund and the
  cancellation reach the studios' tabs through the stream (K5, K6, K7); the stream written in K5 and K6 is read and trimmed
  in K7 and exported; the popularity score of K5 is read in K9; the delete of the database is why the last cron is refused.
- Causes carried out, Looplinks: the payout queue of L4 carries L4's and L7's payouts; the deduplication ids of L4 are why
  the twice-sent cron pays once; the failure callback (L4) pages in L7; the tips message of L1 is delivered (Fernwood) or
  cancelled by its label (Kettle & Pine); the four runs of L2 finish; the commissions of L3 are what L4 and L7 pay; the
  bounty of L6 is why only Ana's 12 Feb run fails; the Stripe outage is why L7's payouts fail, and its end is why the
  re-enqueue succeeds; the sale of Looplinks is why its token is reset at the end.
- Who the monthly load reaches: six pottery studios on 5 Jan and 1 Feb, the two new ones on 2 Feb, eight on 1 Mar; the
  housekeeping of 1 Mar deletes every January and February session before the March load. Who the payout run reaches:
  each partner with unpaid commissions of the month before (Ana and Bruno, both times).
- The rate limit's window (5 per 10 s) and the cache's five-minute expiry are Kiln's choices; the Redis plan's 500K
  commands a month is never approached.
- Beyond the applications' use, so not in this story: QStash schedules (the applications schedule with Vercel crons),
  URL groups, Workflow's waitForEvent, notify and cancel (Dub's workflows use `context.run` only), the DLQ's API (list,
  retry, resume), the Developer API, and rolling keys over the API.

Before launch, Maya deploys Looplinks and sends preview welcome, receipt and follow-up email jobs under one flow-control key (two calls per two seconds, parallelism one). She corrects a mistyped period before publishing. The first two go to different URLs; the enqueued follow-up waits for the next two-second period. A deploy notification hits a briefly unavailable route and retries after two seconds using `pow(2, retried) * 2000`. At one second neither is due; at two seconds both the notification and held follow-up arrive. This happens during Priya’s Monday setup, before Tomás’s 14:00 seed.

Kiln also checks its direct IPv6 loopback REST endpoint with the same issued token; the
bracketed host and port do not change authentication or database selection.
