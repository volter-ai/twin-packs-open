# `@vgai/managed-account-service`

Server-only Clerk + Polar deployment code for VGAI's first-party account and
universal managed-credit boundary. The editor and game runtime never import
this package.

The service owns the durable Clerk-user/Polar-customer mapping, trusted checkout
intents, plans, included and purchased credit grants, billing-cycle resets,
spend controls, and the one reservation/settlement ledger shared by inference,
generation, workspace compute, storage, relay, and deployment. Polar owns
merchant-of-record checkout, payment, subscriptions, and its hosted customer
portal. A browser redirect never grants value: fulfillment re-reads a confirmed
Polar checkout and matches it to the trusted intent; production Polar webhooks
are signature-validated with the official SDK and deduplicated.

Payment is not admission. Managed-provider access requires the server-owned
`vgaiManagedServices: true` Clerk private-metadata flag; a public Clerk signup,
Free account, or even a confirmed paid subscription cannot create that flag.
The account service refreshes it during authenticated access, and the ledger
refuses reservations when it is absent. Internal `/usage/*` routes additionally
require `X-VGAI-Service-Token`, supplied only by first-party service-binding
callers. Arbitrary Polar URL overrides are loopback-only. A deployed Polar Twin
is accepted only through the named, token-sealed service binding; it cannot
grant credits without an admitted Clerk identity and a trusted checkout intent.

Prices and allowances are catalog data: paid plans and credit packs carry Polar
product IDs and integer `includedCredits`/`credits`. Provider-cost-to-VGAI-credit
conversion lives at this boundary. BYOK requests never call the reservation
routes and therefore consume zero VGAI credits.

Production also requires `VGAI_MANAGED_DAILY_CREDIT_LIMIT`: one atomic UTC-day
circuit breaker across every account and managed service. Reserved estimates
and settled actuals count toward it; failed/released work does not. This is an
independent platform-loss ceiling, not a user-visible balance or a second
billing system. Review it together with `VGAI_CREDIT_METER_JSON` before raising
it.

The editor should discover OAuth directly from the Clerk Frontend API via
`VGAI_OAUTH_ISSUER_URL`; this service verifies the resulting native Clerk OAuth
or session token. It does not proxy Clerk's authorization or token endpoints.

For fake-account development, run `npm run dev:managed-services` at the repo
root. That command owns a sealed loopback Clerk + Polar + Fal world, seeds the
catalog, starts this real ledger service in memory, and launches the editor
against it. Fake `.test` emails therefore exercise native Clerk sessions and
Polar checkout instead of an editor-owned account simulation. The in-process
mock control plane remains an isolated unit-test fixture only.

```bash
npm test -w @vgai/managed-account-service
npm run test:managed-services-world
```

The second command boots Clerk, Polar, and Fal through Volter Twin in sealed
mode, exercises VGAI's real HTTP boundaries without a live payment or provider
credential, and always tears the world down. It is a focused protocol test, not
browser e2e.

## Cloudflare deployment

`src/worker.ts` is the production service-binding target named
`vgai-managed-account`. One SQLite Durable Object owns the universal ledger, so
quote/reserve/settle/release operations remain serialized and transactional
across generation, inference, workspace, storage, relay, and deployment. The
Node service and the Worker use the same `ManagedAccountApp` and
`ManagedAccountDatabase`; only the native SQLite driver differs.

Before deploying, bind `VGAI_AUTH` for service-bound Clerk identity and
`POLAR_TWIN` for simulated billing, then configure `POLAR_ACCESS_TOKEN`,
`POLAR_WEBHOOK_SECRET`, `VGAI_BILLING_SERVICE_TOKEN`,
`VGAI_BILLING_CATALOG_JSON`, and `VGAI_CREDIT_METER_JSON` as Worker secrets.
The catalog JSON owns all plan product IDs, included-credit allowances, credit
packs, and display prices. The meter JSON owns the provider-cost conversion and
Cloudflare unit rates. A missing or malformed value prevents the ledger object
from starting; it never falls back to free credits or a mock authority.

`npm run build -w @vgai/managed-account-service` performs a Worker dry-run.
Deployment is deliberately separate (`npm run deploy -w
@vgai/managed-account-service`) because it requires the real production secret
set. `npm run deploy:polar-twin -w @vgai/managed-account-service` deploys the
durable Twin authority; every stateful route requires `POLAR_TWIN_TOKEN`.
