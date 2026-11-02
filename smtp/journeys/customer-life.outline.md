# smtp customer life: outline

## The customer

**Harbourline** is a five-person logistics consultancy in Antwerp that runs its own tools rather than renting them: a
**Rallly** instance (`meet.harbourline.be`, from github.com/lukevella/rallly at `3e63239dbdec`) where clients vote on
workshop dates, and a **Twenty** CRM (`crm.harbourline.be`, twentyhq/twenty at `1d561b8c73c9`). Both send mail through
Harbourline's own relay, a Postfix submission server its operator, Wout, keeps. The relay is what this twin is: in the
World, both applications' SMTP settings point at it, nothing leaves, and what it accepts is read back through its
inspect doors.

Every sender here is nodemailer (../journeys/demand.json): the greeting, EHLO, AUTH with the first mechanism the relay
advertises, `MAIL FROM` with `SIZE=`, `BODY=8BITMIME` and `SMTPUTF8` when advertised, one `RCPT TO` per recipient,
`DATA`, `QUIT`. Rallly makes a new transport per send (`packages/emails/src/transport.ts`, memoized per process, one
message per connection); Twenty's is pooled (`smtp.driver.ts`: `pool: true`), so a second message on a connection
begins with `RSET`. Twenty also checks a user's own SMTP server when they connect their mailbox (`transport.verify()`:
EHLO, AUTH, QUIT).

## People and programs

| who | what they hold | where it comes from |
|---|---|---|
| Wout Janssens, operator | the relay's configuration (the World's `relay` door, standing in for editing `main.cf`) | Harbourline's box |
| Rallly's mailer | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PWD`, `SMTP_SECURE=false` | Rallly's env (`apps/web/.env.sample`) |
| Twenty's mailer (submission credentials permit Harbourline sender-domain mail, without mailbox administration rights) | `EMAIL_DRIVER=SMTP`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD` | Twenty's server env |
| Elise Maes, consultant | a Twenty user who connects her Harbourline mailbox (IMAP and SMTP) to Twenty | her mailbox's credentials |
| clients | their addresses, the polls' participants | — |

## The arc

### 1. The relay, open (Mon 12 Jan 2026)
Wout stands the relay up for the first test: no credentials, no restrictions. Wout also runs a HELO-only socket monitor which uses NOOP to check the relay responds. Rallly's first poll invitation goes out:
EHLO, MAIL with its size and 8BITMIME, one RCPT, DATA with a text and an HTML part. Wout reads it back through the
inspect door, its subject and both parts, and the original MIME boundary when setting up the mail preview.

### 2. Submission locked down (Wed 14 Jan)
The relay now requires authentication and accepts only Harbourline's sender domain (`harbourline.be`), with a 10 MB
limit. Rallly's next send, still without `SMTP_USER`, is refused at MAIL (530); Wout sets Rallly's user and password and
Rallly authenticates with PLAIN (the first mechanism the relay advertises) and delivers. A template left from Rallly's
defaults names `noreply@rallly.co` as its sender and is refused (553, not owned by the user); fixed to
`polls@harbourline.be`, it is delivered.

### 3. Workshop polls (February, sampled)
A poll's invitation to several clients goes as one message per recipient, as Rallly sends it. One client's address was
typed with a space in it and its RCPT is refused (501); the others' invitations are delivered. A participant's name with
an accent (`Zoë`) is in a message's subject, encoded as RFC 2047 words, and the inspect door reads it decoded. A
Brazilian client's address has an accented local part (`joão@portolog.com.br`): nodemailer asks for SMTPUTF8, which the
relay offers, and the message is delivered.

### 4. Twenty's mail (from Mon 2 Mar)
Twenty invites two colleagues to the workspace: two messages over one pooled connection, the second after RSET.
Elise connects her mailbox; Twenty verifies her SMTP server (EHLO, AUTH, QUIT) and a wrong password is refused (535)
until she corrects it. From then Twenty sends her client emails through it; each is delivered.

### 5. The password rotates (Mon 6 Apr)
Wout rotates the relay's password. Rallly's next send, with the old one, is refused (535); the new password is set and
the next send authenticates.

### 6. A large attachment (Thu 14 May, signed copy Mon 18 May)
Twenty's user attaches a 12 MB scanned contract; nodemailer declares its size and the relay refuses it at MAIL (552).
The email goes without it, a link instead. The following Monday Elise forwards a small signed PDF to Wout, who reads its attachment through the inspect door.

### 7. Before the June release
Wout reads delivered test mail by recipient and text when checking a deployment; at the June quarter end he deletes the checked mail.

### 8. Leaving (Mon 14 Dec)
Harbourline moves its mail to a provider's API. The last invitation goes through the relay; Wout checks the retiring relay when a migration diagnostic cannot verify mailboxes or negotiate STARTTLS: VRFY is deliberately disabled and the relay has no certificate. He clears the delivered mail.

## What the life does not do
Application sends never use STARTTLS or implicit TLS (Rallly's `SMTP_SECURE` and LibreChat's `EMAIL_ENCRYPTION` are off: the relay
offers no certificate, the gap), DSN, EXPN or BDAT: no application here asks for them.
