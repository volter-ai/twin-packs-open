# @volter/twin-smtp

A local mail relay: the SMTP submission server nodemailer sends to, over raw TCP. Point `SMTP_HOST`/`SMTP_PORT` (or
cal.com's `EMAIL_SERVER_HOST`/`EMAIL_SERVER_PORT`, or NextAuth's `EMAIL_SERVER`) at it and an unmodified client sends
real SMTP. Every message it accepts is kept in the World and read back through its inspect doors. No captured message is forwarded to an external mail server.

A Protocol 3 pack ([architecture](https://github.com/volter-ai/twin-world/blob/main/docs/contributing/architecture.md), "Protocol 3"). Its surface is RFC 5321's
command-reply table (`spec/`), with RFC 4954's AUTH and RFC 3207's STARTTLS patched in. The front is
`src/semantics/around.ts`, the byte-stream door `src/stream.ts`, and the session machine is in `src/semantics/states.ts`.

```bash
world-smtp serve [--port N] [--inspect-port N] [--root DIR] [--read-only]
```

## What it models

- **A session**, in RFC 5321's order:
  - the greeting, then EHLO (with PIPELINING, SIZE, AUTH when enabled, ENHANCEDSTATUSCODES, 8BITMIME and SMTPUTF8) or
    HELO;
  - MAIL FROM with `SIZE=`, `BODY=` and `SMTPUTF8`, RCPT TO per recipient, DATA with dot-stuffing undone;
  - RSET, NOOP and QUIT.
  - A command out of order is refused with Postfix's words (`503 5.5.1 Error: send HELO/EHLO first`, `nested MAIL
    command`, `need RCPT command`).
- **AUTH PLAIN and LOGIN** (RFC 4616, RFC 4954): once per session, `*` cancels, a wrong password is `535`.
- **The relay's policy**, set through the `relay` door:
  - its hostname;
  - its credentials (without them it is an open relay and advertises no AUTH; with them MAIL is `530` until the client
    authenticates);
  - its sender domains (`553 … not owned by user`);
  - its relay domains (`554 … Relay access denied` for an unauthenticated recipient outside them);
  - local recipient tables for the RFC examples (unknown local mailboxes receive 550);
  - its size limit (`552`, on a declared size and on the data; 10,240,000 bytes by default, Postfix's).
- **Delivered messages**: each keeps its envelope, its bytes and what RFC 5322 and MIME make of them. That is its
  headers (with RFC 2047 words decoded), its text and HTML, and its attachments (base64 and quoted-printable decoded).
- VRFY is disabled and STARTTLS is not available (`454`), as on a Postfix without a certificate.

## Doors

- `POST /_twin/relay {hostname?, auth?, senderDomains?, relayDomains?, maxSize?, localRecipients?}`: the relay's policy.
- `GET /_twin/messages?to=&from=&q=`: the delivered messages, newest first.
- `GET /_twin/messages/{id}`, `/_twin/messages/{id}/raw`, `/_twin/messages/{id}/attachments/{index}`: one message, its
  bytes, one attachment.
- `DELETE /_twin/messages/{id}`, `DELETE /_twin/messages`: deleted.

## Not yet

STARTTLS and implicit TLS (the relay has no certificate), DSN, EXPN, HELP and BDAT are outside the served send path. Conditional TLS configuration is measured in demand; explicit STARTTLS receives 454. The relay does not perform or refresh against a real SMTP root: SMTP provides no mail retrieval API.
