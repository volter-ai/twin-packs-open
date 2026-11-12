# currencyapi customer life

Author: Codex pack builder.

Demanded calls are recorded in demand.json and remain unserved in the retained gap. Scope is unchanged pending a separate implementation; supplying credentials is not opt-in.

Dub at `7e0101363b2ab30afc537c1893f159d1dcba513a` reads the key in
`apps/web/lib/currencyapi/client.ts:11`; `apps/web/lib/assert-env.ts:4`
refuses a missing value. The demanded call is `GET /v3/latest`.

The retained gap has no modeled customer acts, credentials, screens or stored state; demand.json records the unserved demand.
Every spec operation answers the vendor-shaped gap. Published examples stay
in the spec and are counted as unserved; the life has no steps.
