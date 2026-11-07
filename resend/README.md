# @volter/twin-resend

A local Resend. Its API (`api.resend.com`) serves the calls Dub, Twenty and Volter World's platform make: emails
sent singly and in batches and listed, sending domains (created, read, listed, updated, verified, removed), and received
emails and their list. Resend's webhooks go to a team's
endpoints, signed as svix signs them. The inbound CDN (`inbound-cdn.resend.com`) serves a received email's raw message.
The read-only Emails workspace (`resend.com/emails`) lists the same stored sent emails and opens their details,
recorded events, Preview, Plain Text and HTML content. It uses the World's operator access; no Resend account is needed.
Preview blocks external assets and scripts. Sharing, engagement totals and sending from the dashboard are outside this screen's scope.
The detail page leads with its recipient and From/Subject/To overview, followed by the stored event timeline
and content preview. Reply-to, IDs, current status and Created remain available in the Email details disclosure.
Times are the actual stored timestamps, displayed in UTC; timeline icons add no events.
The sidebar follows Resend's published Emails workspace: destinations outside this screen are
shown as disabled labels. Their presence does not add those dashboard features. Sidebar icons
use `brand.volter.ai`; the email-content preview continues to block all external assets.

## Use with an existing app

Use Node 22.6 or newer.

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.192 @volter/twin-resend@1.0.6
./node_modules/.bin/volter world init --name my-app --twins resend --source resend=@volter/twin-resend
```

Run the local executable from this app’s folder; if it is missing, complete the installation here before continuing.

Review the detected vendor and generated bindings before booting. Read the credential names and limitations below; the World supplies throwaway credentials. Then run your app's own command through the World:

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Here `npm test` is your app's existing command; replace it with your app or test command. `down` retains state.
A later `up` resumes it; do not reset or initialize again merely to return.

Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).


A Protocol 3 pack ([architecture](https://github.com/volter-ai/twin-world/blob/main/docs/contributing/architecture.md), "Protocol 3"). Its surface is generated
from Resend's OpenAPI document (`spec/`). Handlers
are in `src/semantics/<family>.ts`, the key front in `src/semantics/around.ts`, the lifecycle in
`src/semantics/clock.ts`, and state machines in `src/semantics/states.ts`.

```bash
world-resend serve [--port N] [--root DIR] [--read-only]
```

## What it models

- **Keys**:
  - A key is made on the API Keys page (a door) and held by its SHA-256.
  - A request with none is `401 missing_api_key`, an unknown one `400`, and a deleted one `403 restricted_api_key`.
  - Everything a key does is its team's.
- **Sending**:
  - `from`, `to` (at most 50), `subject` and a body are required.
  - The sender must be at a verified domain of the team, or at `resend.dev` sending only to the team owner's address.
  - A batch of up to 100 is checked whole before any is sent.
  - Attachment bytes are held in blobs and retained for inbox observation. Scheduled sends (an ISO 8601 date, as Dub sends, or a natural-language offset such as `in 1 min`, at most 30 days ahead) wait until their time before following the ordinary delivery lifecycle; natural language naming a day or a clock time is not read.
- **An email's life**: `queued`, then `sent` at once, when Resend hands it to each recipient's mailbox provider: over
  SMTP, through the kernel's `ctx.mail`, to the World's twin that receives the recipient's domain (twin-world ADR 0032;
  a `gmail.com` address to the gmail twin, where the person reads it). Five seconds later it is `delivered`, or
  `bounced` when a recipient's server refused it (an address with no account, or a domain no twin in the World
  receives, as `.test` addresses are: a `5xx` reply), the bounce carrying the server's reply, or `delivery_delayed`
  when a server answered only for now (a `4xx` reply), which stays undelivered and is not retried. Each recipient's
  reply decides that recipient's event (`email.delivered`, `email.bounced` or `email.delivery_delayed`, several from one
  send), whose `to` names the recipients, across To, Cc and Bcc, that outcome happened to; the email moves once, from all of them: `delivery_delayed` while any is delayed, `bounced` when every
  recipient refused, else `delivered`. Single, batch and
  scheduled sends are read the same way. A scheduled send is handed on when it is released. A recipient may then open it (on a domain with open tracking) or mark it as spam (doors).
- **Domains**:
  - Each has its DKIM, SPF MX and TXT, Tracking and Receiving records.
  - Verifying makes it pending. It is verified ten minutes after the later of the verify and its last record at the
    owner's DNS host (a door), or failed after 72 hours without them.
  - Updated: open and click tracking, TLS, the tracking subdomain and capabilities.
- **Receiving**: mail to a verified receiving domain (a door) is a received email, with attachment metadata and bytes retained, read with its pre-signed raw
  download URL, which lasts an hour.
- **Webhooks**:
  - Sent for `email.sent`, `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.opened`,
    `email.complained` and `email.received`.
  - Each goes to the team's endpoints that subscribe to it, signed with `svix-id`, `svix-timestamp` and
    `svix-signature`.

## The dashboard

- `resend.com/signup`: a person opens their account and its team (named for their organization) and is signed in;
  the World's generated seed opens an organization's declared account here (ADR 0033), and the World's application
  key then lands in that team, whose owner `resend.dev` sends to.
- `resend.com/login`: a team member signs in.
- `resend.com/domains`: the team's domains with their records; Add Domain, and Verify DNS Records.
- `resend.com/emails`: the read-only Emails workspace.

## Doors

- `POST /_twin/api-keys {name, team, owner}` and `DELETE /_twin/api-keys/{id}`: the API Keys page.
- `POST /_twin/webhooks {team, endpoint, events}`: the Webhooks page; answers the signing secret.
- `POST /_twin/dns {name, type, value}`: a record at the owner's DNS host. Supply its fully qualified name: for a domain `example.com`, returned `send` means `send.example.com` and `resend._domainkey` means `resend._domainkey.example.com`; use the returned value unchanged.
- `POST /_twin/mail/{email_id}/open` and `/complain` `{to}`: a recipient's act.
- `POST /_twin/inbound {from, to, subject, text?, html?, inReplyTo?, headers?, received_for?, authentication?, attachments?}`: mail from outside to a receiving domain.
- `GET /_twin/deliveries?to=[&type=][&email=]`: the webhooks sent.

## Not yet

Broadcasts, segments, topics, templates,  suppressions, audiences and contacts, the API
Keys and Webhooks APIs and contact properties: no application here calls them.

## Vendor-backed

Lists are newest first, paged by `limit`, `after` and `before`. A refresh reads sent emails, received emails and domains back from their
lists and detail operations; Resend's signed email events are ingested (each folded into its email by `email_id`, its type the email's
`last_event`); calls are charged within a fixed allowance of 120 per minute, below the documented 600 per minute.
