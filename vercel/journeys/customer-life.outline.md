# Vercel — customer life outline

## The customer

**Pagecraft** is a three-person startup in Lisbon that sells a hosted page builder to small businesses: a bakery's
menu, a photographer's portfolio. It runs as one Next.js app on Vercel, and every customer's pages are served by that
one app. A customer who wants their own address (not `alice.pagecraft.site`) brings a domain, as Dub's customers do: the app
attaches it to Pagecraft's project through Vercel's REST API, shows the customer the one record to set at their own
DNS host (a CNAME to Vercel for a subdomain, an A record for an apex), answers a verification when Vercel asks for one,
and reads the domain's configuration until it serves. Pagecraft's own domain uses Vercel's nameservers, as Dub's bought
domains do.
Pagecraft is a business, so it runs on a Pro team ("the Hobby plan restricts users to non-commercial, personal use
only", vercel.com/docs/plans/hobby).

The story runs from Monday 2 February 2026 to Tuesday 28 April 2026. Its premise: Inês Duarte already has a Vercel
account, made with her email, and the Pro team `pagecraft`, and the project `pagecraft-web`, which Vercel made when she
imported Pagecraft's repository. A registrar's nameserver change and a record set at a customer's own DNS host happen
outside Vercel; in the World each is a step of its own, standing in for that act, at the time the story gives it.

## The people and programs, and what each acts with

| Actor | Who or what | Credential | Its grant |
|---|---|---|---|
| Inês Duarte | co-founder, owns Pagecraft's Vercel account and its Pro team `pagecraft` | her Vercel login: her email and the six-digit one-time password Vercel emails her (vercel.com/docs/accounts) | the dashboard: her account's settings, where she makes and deletes access tokens |
| the Pagecraft app | the Next.js app on Vercel, serving every customer's pages and its dashboard | the access token `pagecraft-app`, scoped to the `pagecraft` team, copied for the application's represented calls | the same team grant |
| the hourly domain check | a Vercel cron of the same app (`vercel.json`, `0 * * * *`, run in UTC) | the same `pagecraft-app` token | the same |
| Pagecraft's customers | Alice (Alice's Bakes, `alicebakes.com`), Bruno (Bruno Lima Photography, `brunolima.photo`), Carla (Carla's Yoga, `carlayoga.pt`), Dmitri (Dmitri's Bikes, `dmitribikes.com`) | their Pagecraft logins (not Vercel's) | they act only in Pagecraft's dashboard and at their registrars; the app acts on Vercel for them |

## The arc

### 1. The token and the Edge Config (Mon 2 Feb)
Inês opens the Account Tokens page; Vercel asks her to log in, emails her a six-digit one-time password, and she enters
it. She creates `pagecraft-app`, scope `pagecraft`, expiring after 90 days, and copies it once ("A token's value appears
only once, at creation", vercel.com/docs/accounts/access-tokens) for the application's following calls. On
the team's Storage page she creates the Edge Config `pagecraft-config` and connects it to the project, which gives the
app its connection string (`EDGE_CONFIG`, the store's id and a read token). The app writes the slugs Pagecraft reserves
(`www`, `app`, `admin`, `api`) as the item `reserved` and the domains it blocks (`phish-bank.com`) as the item `domains`
(`PATCH /v1/edge-config/{id}/items`, as Dub keeps its blocklists).

### 2. Pagecraft's own addresses (Tue 3 Feb)
The app attaches `pagecraft.site`, `app.pagecraft.site` and `*.pagecraft.site` to the project (`POST
/v10/projects/{id}/domains`). A wildcard needs Vercel's nameservers ("Vercel needs access to DNS challenges to issue and
renew wildcard certificates. Use the nameservers method"), so it makes `pagecraft.site` a Vercel DNS zone (`PATCH
/v3/domains/pagecraft.site` with `zone: true`, as Dub's `configureVercelNameservers` does) and Inês points the domain's
nameservers at Vercel's at her registrar. Later that day the app reads `pagecraft.site`'s configuration (`GET
/v6/domains/{domain}/config`) and finds it served.

### 3. Signups, reserved slugs and a ban (Wed 4 Feb, Wed 4 Mar)
A customer picks a slug for their default address. The app reads the reserved slugs from Edge Config (the SDK's
`get('reserved')`, at the connection string's host) and refuses `admin` to one signup; the next signup's slug, bakery, is absent from that same reserved list. On Wed 4 Mar a signup comes from an address at `free-gift-cards.site`, a phishing site: the app reads
the blocked domains (`get('domains')`), and Pagecraft bans it: the app writes the item back with the domain added
(`operation: update`, as Dub's `updateConfig` does), and the next signup's read holds it.

### 4. A customer brings a domain (Alice, Mon 9 Feb)
Alice enters `www.alicebakes.com`. The app checks it against the domains Pagecraft blocks and the terms it refuses in
one read (the SDK's `getAll`, as Dub's `isBlacklistedDomain` does), and, as Dub does for a subdomain, first looks for the
apex's wildcard `*.alicebakes.com` on the project: not there. It attaches the domain to the project; its answer is
verified (no other Vercel account holds `alicebakes.com`). Alice returns to the settings a minute later, unsure whether her save completed; the retry is refused: the
domain is already the account's. The app reads its configuration: misconfigured until the record exists. It shows Alice the
CNAME to set at her DNS host (`cname.vercel-dns-0.com`). She sets it that afternoon, and the hourly check (beat 7) finds
it configured and marks it live.

### 5. Bruno, at the apex, verified (Wed 18 Feb, Thu 19 Feb), and Dmitri (Mon 2 Mar)
Bruno wants `brunolima.photo` itself, which his old portfolio still has on another Vercel account. The attach answers
it unverified with a `verification` challenge ("the domain is already in use by another Vercel account"); the app shows
Bruno the TXT record `_vercel.brunolima.photo` and the A record (`76.76.21.21`). He sets both at his DNS host on Thursday
morning. At 10:00 he opens his domain settings in the same minute as the hourly check: both read the domain unverified
(Dub's verify route and its cron read it first), the hourly check asks Vercel to verify
(`POST /v9/projects/{id}/domains/brunolima.photo/verify`): verified, and Bruno's page, acting on its own earlier read,
asks too and is answered the domain verified. The hourly check marks him live. On Mon 2 Mar Dmitri connects `www.dmitribikes.com` as Alice did.

### 6. Carla never finishes (Tue 3 Mar, Tue 17 Mar)
Carla enters `carlayoga.pt`; the app attaches it and shows her the A record. She never sets it, so the hourly check reads
her domain misconfigured, and her dashboard shows "Waiting for DNS". Pagecraft's rule is 14 days: on Tue 17 Mar, as no
other domain is in use under `carlayoga.pt`, the app removes it from the team (`DELETE /v6/domains/carlayoga.pt`), which
takes it off the project too, as Dub's `removeDomainFromVercel` does, and marks her Pagecraft dashboard as disconnected. Carla then opens her domain settings; that request handler reads the current Vercel association without holding the deletion response.

### 7. The hourly domain check (every hour, from Tue 3 Feb)
For each customer domain not yet live, the check reads the project domain (`GET /v9/projects/{id}/domains/{domain}`)
and its configuration (`GET /v6/domains/{domain}/config`); verified and not misconfigured, it is marked live. It never
writes.

### 8. A second address for Alice (Thu 26 Mar)
Alice adds `order.alicebakes.com` for her ordering page: the app attaches it, and she sets its CNAME the same hour.

### 9. Rotating the app's token (Mon 20 Apr)
`pagecraft-app` expires on 3 May. Inês logs in with a new one-time password, creates `pagecraft-app-2` on the Account
Tokens page (scope `pagecraft`, 90 days), copies its value for the application's following calls. At 10:00 the represented consumer switches to that credential; she deletes `pagecraft-app`. A consumer call still carrying the deleted token is refused, and a connection check with the replacement token succeeds.

### 10. Alice's ordering page closes (Fri 24 Apr)
Alice closes her ordering page. `www.alicebakes.com` is still in use under `alicebakes.com`, so the app removes
`order.alicebakes.com` from the project alone (`DELETE /v9/projects/{id}/domains/order.alicebakes.com`), as Dub's
`removeDomainFromVercel` does when another domain shares the apex; `www.alicebakes.com` still serves. Alice refreshes her domain settings; that request handler reads the removed association without holding the deletion response.

### 11. Dmitri leaves (Tue 28 Apr)
Dmitri closes his Pagecraft account. No other domain is in use under `dmitribikes.com`, so the app removes it from the
team, as for Carla, and `www.dmitribikes.com` is gone from the project with it. Dmitri opens his domain settings; that request handler reads the association without holding the deletion response.

### 12. The nightly reconciliation (Tue 28 Apr, 23:00)
A nightly job of the app checks what its environment names: the team its token acts in (`GET /v2/teams`), the project
(`GET /v10/projects`) and the Edge Config (`GET /v1/global-config`, its two items). It then lists the project's domains
(`GET /v9/projects/{id}/domains`) and the team's (`GET /v5/domains`) against Pagecraft's own records: the five domains in
use on the project and their three apexes, nothing of Carla's, Dmitri's or Alice's ordering page left behind.

## The author's walk

- Every API act is the app's (or its cron's) with the team-scoped token `pagecraft-app`, then `pagecraft-app-2`; Inês
  makes and deletes tokens and the Edge Config on the dashboard, reached by her emailed one-time password. The Edge
  Config is read with its own read token, from the connection string.
- Customers act only in Pagecraft's dashboard and at their DNS hosts; each record they set happens outside Vercel.
- Causes carried out: the reserved slugs written in 1 refuse a signup in 3; the verification asked for in 5 is answered
  because another account held the domain, and none is invented for a domain nobody held (4); a configured domain is
  marked live by the hourly check (7); Carla's never-configured domain is removed after 14 days (6); the old token is
  refused after its deletion (9); a domain sharing its apex with one in use leaves the project alone (10), the last
  under its apex leaves the team (6, 11), and the reconciliation finds exactly what remains (12).
- Refusals the applications meet: an invalid token (9), a project domain that is not there (4, 6, 10, 11), a second attach
  of the account's own domain (4), and a verification whose challenge does not hold yet (5).
- Beyond the applications' use, so not in this story: projects, environment variables, team domains and DNS records made
  through the API (the applications make their project on the dashboard and set no DNS through Vercel).
