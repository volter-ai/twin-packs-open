# twenty-icons customer life

Author: Claude Opus 5.5 (VO-3832).

The customer is Twenty, a CRM whose screens show each company record with its domain's favicon. Twenty builds the
image's address itself (twenty-shared `getLogoUrlFromDomainName`: `https://twenty-icons.com/<domain>`, the domain's
scheme, `www.` and trailing slash removed) and puts it in an `<img>`; when the image fails, its avatar shows the
record's initial instead (twenty-ui `Avatar`). There is no SDK, no credential and no account: the vendor's one
operation is a public GET. The World knows the domains its seed declares (the door below), the five companies Twenty
puts in every new workspace by default.

1. **The World starts knowing Twenty's prefilled companies.** Door `declareIcons` (`POST /_twin/icons`), from the pack's
   default data: airbnb.com at 192, anthropic.com, stripe.com, figma.com and notion.com at 128.
2. **A company's avatar loads.** `getFavicon` `GET /airbnb.com`: 200, `image/png`, a 192×192 PNG, `last-modified` the
   declaration's time, `cache-control: max-age=16070400`. `GET /stripe.com`: its 128×128.
3. **The vendor's own forms of a known name.** `GET /airbnb.com/`: airbnb.com's favicon. A site at its `www.` name:
   the World declares `www.example-co.com`, and `GET /example-co.com` answers its favicon (the vendor fetches
   `https://<domain>`, then `https://www.<domain>`); `GET /www.airbnb.com`, a name of its own the World never
   declared, answers the 404.
4. **A domain the World does not know.** `GET /no-such-domain.example`: 404 `Could not fetch favicon`,
   `text/html; charset=utf-8`, Express's weak ETag; the avatar falls back to the initial.
5. **A name the vendor refuses.** `GET /AIRBNB.COM`: 400 `Invalid domain`, its weak ETag, no Cache-Control.
6. **A domain declared later** (a World's own seed or a scenario): door `POST /_twin/icons` with `acme.dev` at 64, then
   `GET /acme.dev`: its 64×64 PNG.
7. **The host's root.** `getRoot` `GET /`: 301 to the service's README.

Refusals the demand can meet: the 404 of act 4 and the 400 of act 5. Not served (the vendor's gap, NestJS's 404):
`GET /<domain>/<size>`, which Twenty never asks, and the health routes.
