# @volter/twin-gmail

Gmail, the mail half of a World's Google accounts (twin-world ADR 0032). Mail a World's application sends to an address
at `gmail.com` reaches Gmail's receiving server, as on the real internet: the smtp relay and resend hand each message on
through the kernel's `ctx.mail`, which routes `gmail.com` here by this pack's host rules and its `smtp` side port. The
person reads it in Gmail's webmail at `mail.google.com`, signed in to Google, and follows its links.

## Use it in a World

Select `gmail` beside `googleoauth`, which owns the Google accounts and Google's sign-up and sign-in. Declare the people
in `world.json` (ADR 0033): each address at `gmail.com` is a Google account, which the generated seed signs up at
`accounts.google.com/signup`, leaving the person's World browser signed in. A walk loads that browser and opens
`https://mail.google.com/mail/`.

```bash
world-gmail serve [--port N] [--smtp-port N] [--root DIR] [--read-only]
```

## What it models

- **The receiving server** (the side port, RFC 5321, no TLS): any sender; a recipient at `gmail.com` that is a Google
  account is accepted (`+tag` addresses reach the same account), one that is not is `550 5.1.1`, and an address at any
  other domain `550 5.7.1` (it relays for no one). Each accepted message is kept once in each recipient's mailbox, with
  its envelope, its bytes, its headers, text, HTML and attachments.
- **Webmail** (`mail.google.com/mail`): the signed-in person's inbox, newest first; a message with its sender, recipients
  and body (its HTML without scripts, links opening in a new tab; plain text with its addresses linked); its attachments
  downloaded. A browser with no Google session goes to Google's sign-in and back.
- **gmail.com** sends a visitor to the webmail.

The mailboxes are googleoauth's accounts, read through the kernel's cross-pack read (`ownerReads`: `_person`, `account`,
`_web_session`), never written here.

## Not yet

The Gmail API, IMAP and submission (they need TLS on a line-protocol pack), composing and replying, labels, search, and
other providers' domains (Workspace): later cards of ADR 0032. Gmail's dot-insensitive addresses are not modelled.
