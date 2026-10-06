# resend customer life: outline

## The customer

**Kadewerk** is a nine-person agency in Antwerp that runs partner programs for Belgian retailers. It self-hosts three
applications, each unchanged from its repository, and they all send mail through one Resend team, "Kadewerk", each
with a key of its own:

- **Dub** (dubinc/dub at `7e0101363b`) runs the partner programs. It sends its transactional mail with `resend.emails.send`
  and `resend.batch.send`, and gives each program an email domain it creates, updates (a queued job turns open tracking
  on and enforces TLS), reads, verifies and removes through Resend's domains API. Resend's webhooks tell it when an email
  is opened, delivered or bounced.
- **Twenty** (twentyhq/twenty at `1d561b8c73`), its CRM, sends account managers' mail from its own emailing domain,
  which receives replies. Twenty reads a sent email, and reads each received reply and its raw message when Resend's
  `email.received` webhook names it.
- **Postiz** (gitroomhq/postiz-app at `e0a08a7d95`), which schedules its clients' social posts, mails them through
  `resend.emails.send` (`from: 'Name <address>'`, html, `reply_to`).
- **Volter World's platform** (volter-ai/twin-world at `96ca4478bb`), where Kadewerk's developers keep their Worlds,
  sends its own text mail with `resend.emails.send` (a member added, a World deleted) and reads the team's sent mail
  back from Resend's list (`GET /emails`).

The World clock starts 2026-01-01.

## People and programs

| who | holds | how |
|---|---|---|
| Hanne Peeters, CTO, the team's owner (hanne@kadewerk.be) | the dashboard | makes the keys and the webhook endpoints (World doors), sets DNS records at Kadewerk's DNS host (a door) |
| Dub | `RESEND_API_KEY` ("dub"), `RESEND_WEBHOOK_SECRET` | full-access API key, the resend SDK |
| Twenty | its key ("twenty") and its webhook's signing secret | full-access API key, fetch to api.resend.com |
| Postiz | its key ("postiz") | full-access API key, the resend SDK |
| the World platform | its key ("worlds") | full-access API key, the resend SDK, and fetch for the list |

## The arc

### 1. The team and its first domain (Mon 12 Jan)
Hanne makes the four keys. Before any domain is verified, Dub's first send from `partners@mail.kadewerk.be` is refused
(403, "domain is not verified"). Hanne checks connectivity with a test from `onboarding@resend.dev` to her own address. Dub creates `mail.kadewerk.be` by its name (us-east-1, tracking off) for Kadewerk's first
program. Dub's queued job then updates it: open tracking on, click tracking off, TLS
enforced; Hanne inspects the setup before installing DNS. Hanne sets its DKIM and SPF records at the DNS host and Dub asks Resend to verify it. It is pending, and verified ten
minutes after the last record was set.

### 2. Dub's program mail (from Tue 13 Jan, sampled)
Hanne adds Dub's webhook endpoint for `email.delivered`, `email.opened` and `email.bounced`. Dub sends a partner's
welcome, delivered moments later (a signed `email.delivered`), and the partner opens it (`email.opened`). A batch of
three payout notices goes out in one call. One partner's company server refuses mail, so that notice bounces
(`email.bounced`, naming the partner) while the other two are delivered.

### 3. Twenty's domain and replies (from Mon 2 Feb)
Twenty creates `crm.kadewerk.be` with receiving enabled (its records include the receiving MX). Hanne sets every
record, and it is verified. Hanne adds Twenty's webhook for `email.received`, `email.delivered`, `email.bounced` and
`email.complained`. An account manager's email goes out from Twenty, and Twenty reads it back. The client replies:
Resend sends `email.received`, Twenty reads the received email and downloads its raw message at the pre-signed URL,
which threads the reply by its `In-Reply-To`. A later client marks a follow-up as spam (`email.complained`).

### 4. Postiz's mail (Wed 4 Mar)
Postiz tells Els her client's post went out, from `Kadewerk Social <social@mail.kadewerk.be>`, replies going to Hanne.
It reaches Els's inbox, and reads back delivered with Hanne as its reply-to.

### 5. The World platform's mail (Fri 20 Mar)
The platform mails Bart that he was added to Kadewerk, text only. It reads the team's sent mail back newest first, two
at a time: Bart's mail first, delivered, with no bodies in the list, Postiz's after it, and more beyond; the next page
starts after the second.

### 6. A leaked key (Thu 16 Apr)
Postiz's key is committed to a public repository. Hanne deletes it and makes a new one. A queued Postiz job still uses the old configuration and is refused (403 "API key is not active"). Hanne installs the new key and the next notification sends.

### 7. A program ends (Mon 7 Sep)
Dub's program for one retailer ends, and Dub removes its email domain. The team's domain list keeps Twenty's.

## What the life does not do
Broadcasts, segments, topics, templates, audiences and contacts, scheduled sends, the API Keys and Webhooks APIs,
suppressions and attachments: no application here calls them. Twenty handles `email.failed`, which Resend sends when it
cannot send at all; nothing in Kadewerk's year fails so.
