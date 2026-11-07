# Gmail sources

Read 2026-11-07.

- `rfc5321.txt`: RFC 5321, Simple Mail Transfer Protocol, October 2008, immutable RFC edition, upstream
  https://www.rfc-editor.org/rfc/rfc5321.txt (the same bytes as the smtp pack's). SHA256:
  `7d560eddff1b213c17d4e1e5f95005728b2f05bc2b3947f0fcc91717c6707634`. It is the command-reply table of
  Gmail's receiving server (`gmail-smtp-in.l.google.com`, the MX `gmail.com` answers), the surface this pack serves on its
  SMTP side port. Gmail's API and IMAP are not served (ADR 0032, later cards).
- `sources.json` records cited reference pages checked by check-sources; the pack cites the RFC alone.

Gmail's replies on that server (`mx.google.com`, `- gsmtp`, `550 5.1.1 The email account that you tried to reach does
not exist`) are recalled from Gmail's bounces, not read from a published page: the pack says so where it uses them.
