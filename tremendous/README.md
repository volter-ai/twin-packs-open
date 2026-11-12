# @volter/twin-tremendous

Protocol 3 twin scoped to Dub's shipped public-file cron at `dubinc/dub @ 7e0101363b2a`
([demand](./journeys/demand.json)). It serves anonymous
`GET https://api.tremendous.com/prohibited_email_domains.txt`.

The vendor-published file answered `200`, `text/plain; charset=utf-8`, with zero body bytes on
2026-10-03. The twin replays that retained snapshot
([recording](./spec/recordings/prohibited-email-domains.json)). No developer reference page for this path was found;
the published OpenAPI document omits it. The recording establishes the request, status, content type and empty body
at that instant. It does not establish a nonempty blocklist, future contents, or a documented list contract.
No domains are invented.

Dub splits the body into lines, trims and lowercases each, and removes blank entries. It replaces its Redis
prohibited-domain set only when the resulting list is nonempty. The
[life](./journeys/customer-life.json) asserts that computation using the pack's answer view: the snapshot yields
no domains and leaves the existing set intact. The separate disposable-email source is outside this vendor life.

Every credentialed OpenAPI operation is unmodeled and answers the documented API not-found class,
`404` with `{ "errors": { "message": "No resource could be found for the provided ID", "payload": {} } }`.
The public-file front's unknown-path response is not established; this fallback uses the spec's error class,
not a captured unknown-path answer. Dub's campaign and payout calls require `TREMENDOUS_API_KEY`, shipped blank;
they are optional and outside demand.

There are no account credentials, stored vendor resources, seeds, webhooks or `/_twin/` doors. The keyless text read
uses no dashboard or redemption screen, so no screens are built. The descriptor retains routing for both API hosts
so optional requests reach the gap. `vendorBacked.none` records that this public snapshot has no customer state
to deploy or refresh. The upstream OpenAPI bytes remain unchanged; a recording-cited patch adds the omitted path
([provenance](./spec/SOURCE.md)).
