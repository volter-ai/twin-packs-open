# @volter/twin-daily

Protocol 3 twin of Daily's REST API. Nothing is served: every spec operation answers
Daily's JSON gap (`404`, `{"error":"not-found","info":"api endpoint does not exist"}`).
The [error documentation](https://docs.daily.co/docs/rest-api/errors) declares the
404 error class and `error`/`info` envelope; `spec/recordings/404-unknown-endpoint.json`
retains the vendor's exact unknown-endpoint answer. No resource, room screen,
credential or media door, event, state transition or refresh is served.

Cal.com enables daily-video only with an operator-supplied `DAILY_API_KEY` and
valid enabled app keys. The key ships empty. Its pinned settings and optional
call sites are recorded under `optional` in `journeys/demand.json`; the life has
no acts. Published examples remain in the vendor's spec and count as unserved.
`spec/SOURCE.md` preserves the vendor's document, its hash, corrections and
recorded error answers. Call-client media and signalling are outside this REST spec.
