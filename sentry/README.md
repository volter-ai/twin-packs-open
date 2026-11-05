# @volter/twin-sentry

Sentry's Protocol 3 twin serves the demanded applications in [journeys/demand.json](./journeys/demand.json).
The API and ingest share one vendor store.

| Wire | Behavior | Evidence |
|---|---|---|
| DSN hosts, `POST /api/<project>/envelope/` | Error/message events and issues, transactions, sessions, client reports, attachments, replay, profiles, cron check-ins and monitor configuration, feedback, logs and metrics. Receipt bytes and unknown items are retained in blobs. Plain, gzip, deflate, brotli and zstd requests; browser CORS. | [ingest/spec](./ingest/spec/SOURCE.md), with retained reference bytes and an offline writer |
| `sentry.io`, `us.sentry.io`, `de.sentry.io` | sentry-cli release creation, finalization, commits and previous-release lookup, repository listing and source-map chunk/artifact uploads; account project creation and client-key reads; declared vendor refresh reads. | [api/spec](./api/spec/SOURCE.md), Sentry's pinned OpenAPI document and evidenced patches |

The application's SDK authenticates ingestion with its public DSN key. API calls use scoped personal tokens or
organization CI tokens, stored by their hash. The credential door retains the selected organization and each
deployment's project, client key and scoped personal token. It returns the same DSN and token on later issuance,
with the API's native bearer authorization and origin.
Additional projects are created through `createOrganizationProject`; their DSNs are read through `listProjectKeys`.

World account doors:

- `POST /_twin/app-credentials`: bootstrap account, first token and env-named project/DSN.
- `POST /_twin/organizations {slug, name?}`: additional account signup.
- `POST /_twin/auth-tokens {organization, name, kind?, scopes?}`: organization CI or scoped personal token issuance.

Vendor refresh lists organizations, projects, releases, monitors and check-ins to the end of their declared Link continuation. Events and issues are refreshed by their known subject ids, through the core's declared path mappings. Client keys stay under credential custody. Telemetry receipt is not deployed as an account change.
Sentry's API rate-limit page gives endpoint-specific response headers, without a numerical global allowance.

Every other API operation is the declared gap. Source maps are retained and assembled, without server symbolication.
Grouping follows explicit fingerprints, stack frames, exception or message; Sentry's configurable grouping engine is
not reproduced. Repository integrations, release deploys, team membership and additional client-key creation are
outside the demanded calls. Cron outcomes come from received check-ins; scheduled missed/timeout outcomes are not
synthesized. [STANDING.md](../STANDING.md) owns the procedure's form.
