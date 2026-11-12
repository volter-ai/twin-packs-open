# twenty-icons.com

The vendor publishes no API document. `openapi.json` is written from its open-source service, read at
<https://github.com/twentyhq/favicon> commit `fb84fc14394ee60a675fa88a892b912cb4329557` (2026-11-05), and from its
host's answers below:

- `src/favicon/favicon.controller.ts`: `GET /` redirects (301) to the README; `GET /health` and `GET /healthz` answer
  200 empty; `GET :domainName{/:size}` answers `400 Invalid domain` for a name its domain rule refuses, `400 Invalid
  size` for a size not supported, the stored PNG (`Content-Type: image/png`), else fetches and stores the site's favicon
  and answers it, else `404 Could not fetch favicon`.
- `src/favicon/utils/domain.ts`: the domain rule (lowercase; no scheme, no path).
- `src/favicon/favicon.constants.ts`: `SUPPORTED_SIZES` 16, 32, 64, 128, 180, 192 and `DEFAULT_SIZE` 192.
- `src/favicon/favicon.service.ts`: a size not stored answers the largest stored size below it (lines 40-51); the site
  is fetched at `https://<domain>`, then, when that finds no favicon, at `https://www.<domain>` (lines 55-68). Nothing
  in the service strips a `www.` from the name asked: `www.airbnb.com` is a domain of its own, which the host answered
  because that site has a favicon.

SHA-256 `openapi.json`: f0bf5d3ccca7c8f15c9c3c86347dd0e0ad6c85906b743e77432f6086a6360291. No corrections.

## Answers

What the service's source does not say (its CDN's headers, Express's ETags and bodies, the size each domain the demand
names has) is read from the host, `recordings/*.txt`: each the request, its time, the answer's headers (less the
per-request Cloudflare ones) and the body's SHA-256, size and image type, read with curl 8.7.1 on 2026-11-11.

- `cache-control: max-age=16070400`, set by Cloudflare's edge (the source sets none), is on the 200s, the 301 and the
  404s of a GET; the `400 Invalid domain` (`get-uppercase.txt`, `cf-cache-status: BYPASS`) and `POST /airbnb.com`
  (`post-domain.txt`, `cf-cache-status: DYNAMIC`) carry none.
- A 200 carries `content-type: image/png` and `last-modified`, the time its file was stored.
- The text answers (`404 Could not fetch favicon`, `400 Invalid domain`) are Express's `res.send` of a string:
  `content-type: text/html; charset=utf-8` and a weak ETag, the body's length in hex and the first 27 characters of its
  SHA-1 in base64 (`W/"17-vv8JzlAVdhtD0UCj46Ojpk7ccr0"` for `Could not fetch favicon`).
- `GET /` (`get-root.txt`): `301`, `location: https://github.com/twentyhq/favicon/blob/main/README.md`, `vary: Accept`,
  the body `<p>Moved Permanently. Redirecting to …</p>`.
- A route no controller declares (`GET /https://airbnb.com`, `POST /airbnb.com`): NestJS's
  `{"message":"Cannot <METHOD> <path>","error":"Not Found","statusCode":404}`, `application/json`.
- Sizes (largest stored, the answer with no size asked): airbnb.com 192, anthropic.com 128, figma.com 128, notion.com
  128, stripe.com 128, gmail.com 32; `airbnb.com/` answers as airbnb.com (192), and `www.airbnb.com`, fetched as a site
  of its own, at 192.

Read by Claude Opus 5.5 for VO-3832 (twenty-23785's icons), 2026-11-11.
