# @volter/twin-intercom

Protocol 3 twin of Intercom's REST API 2.14 and OAuth token exchange. Every spec
operation answers Intercom's documented `404` error list with `not_found` and
`Resource Not Found`. No vendor resources, credential doors, screens, webhooks
or refresh operations are served.

Dub's client credentials ship unset. Cal.com ships its global Intercom app disabled
and requires administrator-configured keys. Their pinned configuration gates and
evidence remain under `optional` in `journeys/demand.json`. The customer life has
no acts; the vendor's published examples remain unchanged and count as unserved.

The gap, error-envelope and authentication citations are in `src/manifest.ts`.
`spec/SOURCE.md` records the unchanged upstream document, its hash and the OAuth patch.
