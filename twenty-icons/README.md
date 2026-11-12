# @volter/twin-twenty-icons

Twenty's favicon provider, twenty-icons.com, for an unchanged Twenty: each company avatar's `<img>` and the server's
inferred workspace logo load `https://twenty-icons.com/<domain>` and get a PNG, or the vendor's 404 for a domain it
cannot fetch, on which Twenty's avatar shows the record's initial.

## Use it in a World

Choose this package's exact release in the [catalog](https://world.volter.ai/twins/twenty-icons).
Its Setup tab supplies release-specific installation and World initialization commands.
Review the selected vendor, retain its package/version and lockfile, and run the app through
the World. [First local World](https://world-docs.volter.ai/docs/getting-started) explains the shared workflow.

## Client workflow

There is no SDK, key or account: the service is a public GET. `journeys/first-use.json` is Twenty's own URL builder
(twenty-shared `getLogoUrlFromDomainName` at twentyhq/twenty e79b3365) loading `airbnb.com`'s favicon, asserted a
192-pixel PNG, and a domain the World does not know, asserted the vendor's `404 Could not fetch favicon`.

## Data and behavior

**Known domains are World state.** The vendor learns a domain by fetching the site's favicon on its first request; a
World fetches no site, so a domain is known when the World declares it, with the largest size the vendor would hold
for it, through the door `POST /_twin/icons` (`{ "icons": [{ "domain": "acme.dev", "size": 64 }] }`, the size one of
16, 32, 64, 128, 180 or 192, 192 when not given). The pack's default data (`src/semantics/seed.ts`), which
`volter world init` copies into the World as `seeds/defaults/twenty-icons.data.ts` for the World to own and edit,
declares the five companies Twenty puts in every new workspace, at the sizes the vendor answered for them: airbnb.com
192; anthropic.com, figma.com, notion.com and stripe.com 128. A World's own seed or a scenario declares any other
domain through the same door; nothing in the pack's code names a domain.

**No real logos.** A known domain's favicon is a flat PNG of the declared size, its colour drawn from the domain's name
(world-core's `placeholderPng`), labeled in its tEXt chunk as this twin's: the same bytes for the same domain and size
in every World.

**The vendor's answers.** `GET /<domain>`: the vendor's domain rule (lowercase, no scheme, no path) or `400 Invalid
domain`; a declared domain, or one whose `www.` name is declared (the vendor fetches `https://<domain>`, then
`https://www.<domain>`; a `www.` name is a domain of its own), answers `image/png` with `Last-Modified` the time the
World declared it; any other `404 Could not fetch favicon`. The text answers are `text/html; charset=utf-8` with
Express's weak ETag. The host's `Cache-Control: max-age=16070400` (its CDN's) is on the 200, the 301 and the 404, not
on the 400, as the host's answers carry it. `GET /` redirects (301) to the service's README. A trailing slash answers as
the name without it. Declared domains are kept across stop and resume and cleared by reset, as any World state.

## Scope and limits

Served: `GET /<domain>` (the one call Twenty makes) and `GET /`. The vendor's gap (NestJS's `404 Not Found` JSON):
`GET /<domain>/<size>`, which Twenty never asks, and the health routes. A gap's message is the template's `Not Found`
where NestJS names the route (`Cannot GET /x`), and it carries no Cache-Control, where the host's answer to an unknown GET route does.
The catalog's Evidence tab records actual measured journeys and their exact tool versions.

## Package facts

Protocol 3; the vendor publishes no API document, so `spec/openapi.json` is written from its open-source service
(twentyhq/favicon at fb84fc14) and its host's recorded answers, provenance in `spec/SOURCE.md`. Apache-2.0; Node
>=22.3; `@volter/world-core` ^3.0.179; issues at https://github.com/volter-ai/twin-packs-p3/issues.
Contributor mechanics belong to the [pack procedure](https://world-docs.volter.ai/docs/contributing/architecture#creating-a-pack).
