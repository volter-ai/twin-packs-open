# SMTP sources

Read 2026-10-01.

- `rfc5321.txt`: RFC 5321, Simple Mail Transfer Protocol, October 2008, immutable RFC edition, upstream https://www.rfc-editor.org/rfc/rfc5321.txt. SHA256: `7d560eddff1b213c17d4e1e5f95005728b2f05bc2b3947f0fcc91717c6707634`.
- `patches.json` corrects the command/reply table with AUTH (RFC 4954), STARTTLS (RFC 3207), authentication-required MAIL and Postfix recipient refusal. Each patch names its source and quote; the RFC bytes are unchanged.
- `sources.json` records cited reference pages and Postfix source replies checked by check-sources.

References read: RFC 5321 sections 4.1, 4.2, 4.3.2, 4.5.2 and Appendix D; https://www.rfc-editor.org/rfc/rfc4954, https://www.rfc-editor.org/rfc/rfc3207, https://www.rfc-editor.org/rfc/rfc4616, https://www.rfc-editor.org/rfc/rfc5322, https://www.rfc-editor.org/rfc/rfc2045 and https://www.rfc-editor.org/rfc/rfc2047; https://www.postfix.org/postconf.5.html; Postfix's smtpd sources under https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/ (smtpd.c, smtpd_check.c, smtpd_sasl_proto.c, smtpd_sasl_glue.c). Exact quotes and fetch results are in `sources.json`.
