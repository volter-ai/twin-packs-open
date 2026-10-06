# @volter/twin-cloudflare

For Open Autonomy, RH2, the platform callers and the shipped storage, custom-domain and CAPTCHA features of Dub, Twenty, Cal.com, Rallly and LibreChat. Postiz’s alternative storage driver and Twenty’s optional CAPTCHA driver are recorded in `journeys/demand.json` and exercised by the customer life. A local Cloudflare: the API v4 that the unmodified `cloudflare` SDK and wrangler call (`api.cloudflare.com/client/v4`,
the `api/` lane), and R2 over its S3 API (`<account>.r2.cloudflarestorage.com`, the `r2/` lane). It also covers the
dashboard's sign-in and its API Tokens pages (My Profile's and R2's, `dash.cloudflare.com`), and Turnstile's `api.js`,
its challenge frame and siteverify (`challenges.cloudflare.com`), all over one vendor state.

## Use with an existing app

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.67 @volter/twin-cloudflare@3.0.11
npx volter world init --name my-app --twins cloudflare --source cloudflare=@volter/twin-cloudflare
```

Review the detected vendor and generated bindings before booting. Read the credential names and limitations below; the World supplies throwaway credentials. Then run your app's own command through the World:

```console
npx volter world up
npx volter world run -- npm test
npx volter world log
npx volter world down
```

Here `npm test` is your app's existing command; replace it with your app or test command. `down` retains state.
A later `up` resumes it; do not reset or initialize again merely to return.

Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).


A Protocol 3 pack of lanes ([architecture](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md), "Protocol 3" and "Other wires:
lanes"). Each lane's surface is generated from its own spec (`api/spec`: Cloudflare's OpenAPI document; `r2/spec`:
S3's model with R2's differences). Its handlers are in `<lane>/src/semantics/<family>.ts`, its state machines in
`<lane>/src/semantics/states.ts`, and operations outside scope answer the lane's gap (API "No route for the URI", R2 NotImplemented).

```bash
world-cloudflare serve [--port N] [--root DIR] [--read-only]
```

## The World's Cloudflare

The application's account comes from the World's credential door (`/_twin/app-credentials`). A zone is added through
the API (`POST /zones`) and turns active when the registrar's nameservers are published (the `dns` door).

- **API tokens**: one model for both lanes. A token is a set of policies, each allowing permission groups
  (`Workers Scripts Write`, `DNS Write`, `Workers R2 Storage Bucket Item Read`, …) over an account, a zone (or every
  zone of an account), R2 buckets or the person.
- **Where tokens are made**: on R2's API Tokens page, or on My Profile's API Tokens page from a template URL
  (`permissionGroupKeys`), as Open Autonomy's setup links it.
- **Checking**: a token is kept by its SHA-256. The API refuses an operation whose permission group the token lacks on
  the account or zone it names (403, code 10000), and a disabled or expired token (401).
- **R2 credentials**: R2's S3 credentials are the token's id and the SHA-256 of its value.

## What it models

- **Workers**: a module upload with its assets (multipart, deployed at once) and its Durable Object migrations (classes
  made, renamed and deleted), the service read, the workers.dev subdomain and a script's route on it, its settings read,
  Cron Trigger schedules installed and read back, secrets put (their text never answered, kept across uploads), the deployments and versions lists, a version's detail
  and the account's scripts, as wrangler deploys and the platform's deploy rehearsal reads back.
- **R2**: buckets through the API and the S3 API (with a location hint, or made by an upload's
  `cf-create-bucket-if-missing`); objects (their checksums checked), presigned URLs, CORS and lifecycle configurations
  (R2's default rule aborting an upload after seven days), listings by delimiter and continuation token, multipart
  uploads (large-part completion, composite/full-object checksums and SSE-C key-gated objects), custom domains attached and listed through the API, and public reads at them.
- **Workers static assets and Custom Domains**: the files `wrangler deploy` uploads through an assets upload session
  (each kept with the content type it was uploaded with), a version's assets served once a deployment sends it the
  traffic (a new version upload and a deployment are wrangler's path for a Worker it has deployed before), the config's
  `html_handling`, `not_found_handling`, `_redirects` and `_headers` (parsed as the API parses them), and a hostname in
  one of the account's active zones attached as the Worker's Custom Domain (the Domains API, or wrangler's changeset and
  domain records); a hostname the zone holds DNS records at is refused, as Cloudflare refuses it. Inside the World the
  hostname answers as Cloudflare's asset worker does (`src/semantics/shared.ts`, ported from Cloudflare's
  `workers-shared`).
- **Zones**: a zone's DNS records listed, made and deleted, with vendor timestamps and type-dependent proxy capability; the internal zone parent never appears in the record reply; Cloudflare for SaaS custom hostnames (listed, made, edited, deleted). A
  hostname's ownership and certificate validation records are computed for the method chosen, and it turns active
  when its customer publishes them.
- **Turnstile**: widgets made through the API (sitekey and secret), the `api.js` widget and its challenge, a visitor's token checked once at siteverify
  within 300 seconds (`timeout-or-duplicate` after).
- **Tokens**: verification (`/user/tokens/verify`), an account's tokens listed, and a token rolled or revoked on the
  dashboard's token pages.
- **A vendor-backed World**: every stored resource is read back (the account, zones and custom hostnames, the account's
  tokens, each zone's DNS records retaining their vendor IDs, Workers with each version's detail, deployments and secrets, Durable Object namespaces, the workers.dev
  subdomain, Turnstile widgets from their secret-free listings, Notifications destinations and policies, buckets per
  jurisdiction and their custom domains, objects with their bytes and headers, in-progress uploads and their parts);
  the API's calls are sent with the root's token, R2's to the account's own host signed with SigV4 under the root's R2
  keys (the descriptor's `lanes` strategy). A widget's live secret is not read back; its synthetic secret remains available through the detail API. A person and their memberships are not read back: the root's account token
  acts as no user. A deploy sends the World's account as the one the root's token reaches (`account`), and a script or
  version upload with static assets runs Cloudflare's upload protocol again (`performs`, `uploadWithAssets`: the session
  opened with the manifest the World's session held, the files from the World's blobs with the JWT Cloudflare issues,
  then the upload with its completion token).
- **Notifications**: webhook destinations and policies made and listed; the SSL for SaaS Custom Hostnames alert
  (validation, issuance, deployment, deletion) sent to a policy's webhooks with `cf-webhook-auth`, the destination's
  secret, as Twenty's guard reads it.

## Doors

- `POST /_twin/users/{email} {password}` (dash.cloudflare.com): a person who can sign in.
- `POST /_twin/app-credentials`: the application's account and token.
- `POST /_twin/dns {name, type, value}`: a record published at a DNS host outside Cloudflare (a SaaS customer's own
  domain, or a registrar's nameservers for a zone), which Cloudflare's checks then see.
- `GET /_twin/deliveries?to=&type=`: every notification sent, as the receiving server got it.
- `GET /_twin/hosts`: the hostnames the World routes here: custom domains connected to R2 buckets, Workers Custom
  Domains and enabled `workers.dev` deployment URLs.

## Not yet

- A Worker's requests: the World's Workers are uploaded and deployed, never run; at a Custom Domain or `workers.dev` URL only the Worker's
  static assets answer (a request its script would take is refused with 501).
- A vendor-backed refresh reads a bucket, not its CORS or lifecycle configuration, and a part, not its bytes (no S3
  operation answers a part's bytes): an observed part completes nothing until it is uploaded again.
