# Dub's Tremendous blocklist read

Author: Contributor 42

A person operates a local Dub installation at `dubinc/dub @ 7e0101363b2a`. The shipped
`POST /api/cron/disposable-emails` can run locally: QStash verification is skipped outside Vercel
(`apps/web/lib/cron/verify-qstash.ts:15`). No Tremendous key is configured.

One act: the cron fetches the public prohibited-email-domain file without Authorization
(`apps/web/app/(ee)/api/cron/disposable-emails/route.ts:15` → `get_prohibited_email_domains_txt`, handler).
Tremendous's retained 2026-10-03 public file answers HTTP 200 with an empty plain-text body.
Dub trims and lowercases the lines and filters blanks (lines 35–41); this yields an empty list.
Its nonempty guard (line 53) leaves the existing `tremendousProhibitedEmailDomains` Redis set unchanged.
The life's answer view asserts the text, normalized list and guard outcome, without adding a Redis call.

The separate disposable-email source in the cron is outside this vendor's story. Payout campaigns,
orders, funding and redemption require the operator's optional payout configuration and are outside demand.
No account, dashboard, credential door, seed or stored mutation is part of this act.

Evidence stops at the retained public file's response. No reference page defining this endpoint was found,
and no promise of a nonempty list or of future contents is inferred. The life asserts a snapshot, not a
future vendor guarantee.
