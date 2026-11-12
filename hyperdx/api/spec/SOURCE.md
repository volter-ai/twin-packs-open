# HyperDX's External API v2

- **Why this document:** HyperDX's own OpenAPI document for its External API, `packages/api/openapi.json` in
  hyperdxio/hyperdx, generated from the routers' `@openapi` comments
  (https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/openapi.json),
  vendored as `openapi.json`, unchanged but for two public example scalars (Packaged public example scalars, below).
- **Version:** the document's `info.version` `2.0.0`, at hyperdxio/hyperdx commit `049ec84245d4e0572a6301b2179265fbbbb344e3`.
- **sha256** of `openapi.json` as packaged: `b763f900bb58aef21f6f2a56ea66b6330acb7cf20f8d96d933382eaeab6a6be9`.
- **Grouping** (`grouping.json`): an operation's family is its tag (`Sources`, `Search`, `Alerts`, …); every path
  begins `/api/v2/`.
- **Servers:** the document names `/`, "Your HyperDX instance"; HyperDX's CLI reaches `https://api.hyperdx.io` when no
  API URL is given (`packages/cli/src/sourcemaps.ts`, cited in `../../src/manifest.ts`).
- **Corrections:** none. Where the document and the server disagree (the 401 answer: the document shows
  `{message}`, the server's `validateUserAccessKey` sends Express's plain `Unauthorized`), the twin answers as the
  server does (`../src/manifest.ts`, `../../journeys/vendor-examples.json`).
- **The server read beside it**, at the same commit: `packages/api/src/routers/external-api/v2/index.ts`, `search.ts`,
  `sources.ts` and `utils/search.ts`; `packages/api/src/middleware/auth.ts`, `middleware/error.ts`,
  `utils/enhancedErrors.ts`, `utils/zod.ts`, `config.ts`, `setupDefaults.ts`, `mcp/tools/query/helpers.ts`;
  `packages/common-utils/src/queryParser.ts`, `externalSource.ts`, `core/searchChartConfig.ts`,
  `core/renderChartConfig.ts`, `clickhouse/index.ts`; `docker/hyperdx/entry.local.base.sh` (the default sources) and
  `docker/otel-collector/schema/seed/00002_otel_logs.sql`, `00005_otel_traces.sql` (the tables' columns); and the
  collector's ClickHouse exporter (opentelemetry-collector-contrib v0.155.0, `exporter/clickhouseexporter`), which
  writes those rows. Each fact taken from them is a `// source:` line where it is used (`sources.json`).

## Packaged public example scalars

`api/spec/openapi.json` retains the pinned source above with only the string-scalar replacements listed below. The original input is retained in twin-packs-p3, outside the published package, at `retained-originals/hyperdx/api/spec/openapi.json.gz` (the original is its decompressed bytes). Original SHA-256: `a7cac1e12b89e07c5de59c5117e26ff95646f48c9e2fc59be853aa77c97f3bd9`; packaged SHA-256: `b763f900bb58aef21f6f2a56ea66b6330acb7cf20f8d96d933382eaeab6a6be9`. Every byte outside the listed JSON string values is unchanged. These public samples are inert, and no operation's shape reads them.

| JSON pointer | Packaged value | Reason |
| --- | --- | --- |
| `/components/schemas/SlackWebhook/properties/url/example` | `https://hooks.example.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX` | Slack's placeholder incoming-webhook URL, which secret scanners read as a webhook; the host moves to example.com and the path keeps its form. |
| `/components/schemas/WebhookInput/properties/url/example` | `https://hooks.example.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX` | The same sample, the same replacement. |

The operations the twin serves are decided in ../../journeys/decisions.json; the rest answer the gap.
Read by: Claude (Opus 5.5), 2026-11-09.
