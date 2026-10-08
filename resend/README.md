# @volter/twin-resend

A local Resend. Its API (`api.resend.com`) serves the calls Dub, Twenty, Postiz and Volter World's platform make: emails
sent singly and in batches and listed, sending domains (created, read, listed, updated, verified, removed), and received
emails and their list. Resend's webhooks go to a team's
endpoints, signed as svix signs them. The inbound CDN (`inbound-cdn.resend.com`) serves a received email's raw message.

## Use with an existing app

Use Node 22.6 or newer.

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.147 @volter/twin-resend@1.0.2
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


A Protocol 3 pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md)). Its surface is generated
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
  - Attachment bytes are held in blobs and retained for inbox observation. Dub's ISO scheduled sends wait until their requested time before following the ordinary delivery lifecycle.
- **An email's life**: `queued`, then `sent` at once. Five seconds later it is `delivered`, or `bounced` when a
  recipient's server refuses its domain's mail (a door). A recipient may then open it (on a domain with open tracking)
  or mark it as spam (doors).
- **Domains**:
  - Each has its DKIM, SPF MX and TXT, Tracking and Receiving records.
  - Verifying makes it pending. It is verified ten minutes after the later of the verify and its last record at the
    owner's DNS host (a door), or failed after 72 hours without them.
  - Updated: open and click tracking, TLS, the tracking subdomain and capabilities.
- **Receiving**: mail to a verified receiving domain (a door) is a received email, with attachment metadata and bytes retained, read with its pre-signed raw
  download URL, which lasts an hour.
- **Webhooks**:
  - Sent for `email.sent`, `email.delivered`, `email.bounced`, `email.opened`, `email.complained` and `email.received`.
  - Each goes to the team's endpoints that subscribe to it, signed with `svix-id`, `svix-timestamp` and
    `svix-signature`.

## Doors

- `POST /_twin/api-keys {name, team, owner}` and `DELETE /_twin/api-keys/{id}`: the API Keys page.
- `POST /_twin/webhooks {team, endpoint, events}`: the Webhooks page; answers the signing secret.
- `POST /_twin/dns {name, type, value}`: a record at the owner's DNS host. Supply its fully qualified name: for a domain `example.com`, returned `send` means `send.example.com` and `resend._domainkey` means `resend._domainkey.example.com`; use the returned value unchanged.
- `POST /_twin/recipients/{domain} {rejects}`: an outside server that refuses mail.
- `POST /_twin/mail/{email_id}/open` and `/complain` `{to}`: a recipient's act.
- `POST /_twin/inbound {from, to, subject, text?, html?, inReplyTo?, headers?, received_for?, authentication?, attachments?}`: mail from outside to a receiving domain.
- `GET /_twin/mail?to=`: an inbox.
- `GET /_twin/deliveries?to=[&type=][&email=]`: the webhooks sent.

## Not yet

Broadcasts, segments, topics, templates,  suppressions, audiences and contacts, the API
Keys and Webhooks APIs and contact properties: no application here calls them.

## Vendor-backed

Lists are newest first, paged by `limit`, `after` and `before`. A refresh reads sent emails, received emails and domains back from their
lists and detail operations; Resend's signed email events are ingested (each folded into its email by `email_id`, its type the email's
`last_event`); calls are charged within a fixed allowance of 120 per minute, below the documented 600 per minute.
