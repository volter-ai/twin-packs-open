# gmail customer life: outline

## The customer

**Harbourline** is a five-person logistics consultancy in Antwerp that runs its own tools: a **Rallly** instance
(`meet.harbourline.be`) where clients vote on workshop dates, sending through Harbourline's own Postfix relay (the smtp
twin's customer). Its clients read their mail at Gmail. This twin is Gmail's side of that mail: the receiving server
`gmail.com`'s MX answers (`mx.google.com`), which takes a message for a Google account's address and keeps it in that
account's mailbox, and the webmail at `mail.google.com` where the account's person reads it. In the World the relay
hands each gmail.com recipient's message to this server (twin-world ADR 0032), and nothing leaves.

The server is an MX: it takes mail from any sender without authentication, advertises no AUTH and no STARTTLS here,
holds only gmail.com addresses that are Google accounts, and relays for no one. Every sender reaching it is a relay
(Harbourline's), speaking as world-core's transfer does (../journeys/demand.json): the greeting, EHLO, `MAIL FROM` with
`BODY=8BITMIME` for 8-bit bytes, one `RCPT TO` per gmail.com recipient, `DATA`, `QUIT`.

## People and programs

| who | what they hold | where it comes from |
|---|---|---|
| Harbourline's relay | nothing toward Gmail: an MX asks no credential | Harbourline's box |
| Maya Okafor, a client | the Google account `maya.okafor@gmail.com`, signed in to in her browser | her sign-up at Google (googleoauth) |
| Tom Brennan, a client | the Google account `tom.brennan@gmail.com` | his sign-up at Google (googleoauth) |
| Wout Janssens, Harbourline's operator | the relay's configuration | Harbourline's box |

## The arc

### 1. The first invitation (Mon 12 Jan 2026)
Maya and Tom already hold their Google accounts. Rallly's first poll invitation leaves Harbourline's relay for both:
the relay connects, reads the greeting (`220 mx.google.com ESMTP`), says EHLO and reads what the server offers (SIZE of
157,286,400 bytes, 8BITMIME, ENHANCEDSTATUSCODES, PIPELINING, SMTPUTF8, and neither AUTH nor STARTTLS), gives its
sender, names both recipients (each `250 2.1.5 OK`), sends the message after `354 Go ahead` and has it taken
(`250 2.0.0 OK`), then quits. Each mailbox now holds the invitation once, unread, in its inbox.

### 2. Maya reads it (Mon 12 Jan, evening)
Maya opens `mail.google.com` in a browser that is not signed in and is sent to Google's sign-in with her inbox as the
place to come back to; signed in, she sees her inbox with the invitation at the top, unread. She opens it: its sender,
subject, date and body, and the calendar event Rallly attached, which she downloads.

### 3. A typo (Wed 14 Jan)
A Rallly participant types Tom's address as `tom.brenan@gmail.com`. The relay names it at RCPT and is refused
(`550 5.1.1 The email account that you tried to reach does not exist.`): no Google account holds it, and nothing is
kept. The same message's other recipient, Maya, is taken in the same transaction.

### 4. Maya's tagged address (Mon 19 Jan)
Maya changes her Rallly address to `maya.okafor+rallly@gmail.com`, so she can filter Rallly's mail. Rallly's
confirmation reaches her own mailbox: Gmail delivers a `+tag` address to the account it tags, keeping the address the
sender used on the message's envelope. She reads it in the same inbox and follows its link.

### 5. A misrouted message (Tue 3 Feb)
Wout tests a new relay rule that wrongly sends a message for `ops@harbourline.be` to Gmail's server. Gmail relays for
no one: the recipient is refused at RCPT (550), and the relay keeps the message for its own
retry, which Wout fixes.

### 6. An oversized export (Mon 16 Feb)
A Rallly admin export with a large attachment declares a size above the server's advertised limit in `MAIL FROM`
(`SIZE=`) and is refused before any data (`552 5.3.4 Your message exceeded Google's message size limits.`); Wout's
relay reports it to the sender.

### 7. Tom reads his mail (Mon 2 Mar)
The March poll's reminder reaches Tom in the morning. That evening he opens Gmail for the first time since January,
signs in, and sees his own mail newest first: the reminder, then January's invitation; nothing of the mistyped address
(it was never his) and nothing of Maya's. He opens the reminder. Maya had shared a link to her copy of January's
invitation; opened in Tom's mailbox, it names nothing ("That message could not be found."): each person reads only
their own mailbox.

## Not covered

A Google account deleted: Google's sign-up and sign-in serve no deletion, so the mail an account loses with it is not
walked here.

Delivery to Gmail's MX host straight from an application (`gmail-smtp-in.l.google.com`, as a sending server reaches it):
no application integrates Gmail. Every sender here reaches it through its sending provider, the relay.

## Time

Seven sittings over seven weeks, 12 January to 2 March 2026, after both clients made their Google accounts. A mailbox keeps what it was given; nothing in this life
waits on Gmail's own retention windows.
