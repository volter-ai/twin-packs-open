// HyperDX's manifest: a vendor of two APIs, each a lane: its OTLP ingest (`ingest`, the OpenTelemetry collector its SDKs
// and any OpenTelemetry exporter send traces, logs and metrics to) and its External API v2 (`api`, read with a personal
// API key: its sources and its search over the logs and traces the ingest kept). Both are one service, so one store.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'hyperdx',
  discovery: {
    twinOf: "HyperDX: its OTLP/HTTP ingest (/v1/traces, /v1/logs, /v1/metrics) and its External API v2's sources and search over the logs and traces it keeps",
    stores: 'each exported span, log record and metric data point in OTLP field names with its resource and scope; the team and its personal API keys (by their SHA-256)',
  },
  lanes: {
    routes: [
      { lane: 'ingest', host: '^in-otel\\.hyperdx\\.io$' },
      { lane: 'ingest', path: '/v1/traces' }, { lane: 'ingest', path: '/v1/logs' }, { lane: 'ingest', path: '/v1/metrics' },
    ],
    default: 'api',
  },
  // What of the records identifies a person (twin-world architecture, "Replicating an issue"), by stored type and path:
  // the attributes OpenTelemetry's semantic conventions give a person, their address, user agent and the URL they asked
  // (each attribute kept under its dotted key holding its AnyValue, a string's `string_value`; ../ingest/src/engine/records.ts),
  // on a span, its events, a log record and a data point; and every instant (nanoseconds as decimal strings), so one
  // offset moves them all and their intervals hold.
  privacy: {
    identifiers: {
      span: {
        'attributes.user.id.string_value': 'id', 'attributes.user.email.string_value': 'email', 'attributes.user.name.string_value': 'name', 'attributes.user.full_name.string_value': 'name', 'attributes.enduser.id.string_value': 'id', 'attributes.client.address.string_value': 'ip', 'attributes.http.client_ip.string_value': 'ip', 'attributes.net.peer.ip.string_value': 'ip', 'attributes.user_agent.original.string_value': 'agent', 'attributes.http.user_agent.string_value': 'agent', 'attributes.url.full.string_value': 'url', 'attributes.http.url.string_value': 'url', 'attributes.http.target.string_value': 'url',
        'events.attributes.user.id.string_value': 'id', 'events.attributes.user.email.string_value': 'email', 'events.attributes.user.name.string_value': 'name', 'events.attributes.user.full_name.string_value': 'name', 'events.attributes.enduser.id.string_value': 'id', 'events.attributes.client.address.string_value': 'ip', 'events.attributes.http.client_ip.string_value': 'ip', 'events.attributes.net.peer.ip.string_value': 'ip', 'events.attributes.user_agent.original.string_value': 'agent', 'events.attributes.http.user_agent.string_value': 'agent', 'events.attributes.url.full.string_value': 'url', 'events.attributes.http.url.string_value': 'url', 'events.attributes.http.target.string_value': 'url',
        start_time_unix_nano: 'time', end_time_unix_nano: 'time', 'events.time_unix_nano': 'time',
      },
      log_record: {
        'attributes.user.id.string_value': 'id', 'attributes.user.email.string_value': 'email', 'attributes.user.name.string_value': 'name', 'attributes.user.full_name.string_value': 'name', 'attributes.enduser.id.string_value': 'id', 'attributes.client.address.string_value': 'ip', 'attributes.http.client_ip.string_value': 'ip', 'attributes.net.peer.ip.string_value': 'ip', 'attributes.user_agent.original.string_value': 'agent', 'attributes.http.user_agent.string_value': 'agent', 'attributes.url.full.string_value': 'url', 'attributes.http.url.string_value': 'url', 'attributes.http.target.string_value': 'url',
        time_unix_nano: 'time', observed_time_unix_nano: 'time',
      },
      metric_point: {
        'attributes.user.id.string_value': 'id', 'attributes.user.email.string_value': 'email', 'attributes.user.name.string_value': 'name', 'attributes.user.full_name.string_value': 'name', 'attributes.enduser.id.string_value': 'id', 'attributes.client.address.string_value': 'ip', 'attributes.http.client_ip.string_value': 'ip', 'attributes.net.peer.ip.string_value': 'ip', 'attributes.user_agent.original.string_value': 'agent', 'attributes.http.user_agent.string_value': 'agent', 'attributes.url.full.string_value': 'url', 'attributes.http.url.string_value': 'url', 'attributes.http.target.string_value': 'url',
        time_unix_nano: 'time', start_time_unix_nano: 'time', 'exemplars.time_unix_nano': 'time',
      },
    },
    // the counts a developer asks of an incident, none grouped by what identifies a person
    questions: [
      { type: 'span' }, { type: 'span', by: 'name' }, { type: 'span', by: 'kind' }, { type: 'span', by: 'status.code' }, { type: 'span', by: 'resource.attributes.service.name.string_value' },
      { type: 'log_record' }, { type: 'log_record', by: 'severity_text' }, { type: 'log_record', by: 'resource.attributes.service.name.string_value' },
      { type: 'metric_point', by: 'metric.name' },
    ],
  },
  vendorBacked: { none: "HyperDX keeps what exporters send and its External API reads it back only as a projection into its ClickHouse columns (searchEvents), from which the OTLP records the World keeps cannot be made again; every operation that changes HyperDX (sources, alerts, dashboards, webhooks, the team) answers the gap. Nothing is performed against or refreshed from the vendor." },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-hyperdx',
    resources: ['span', 'log_record', 'metric_point'],
    specSource: "The OTLP specification 1.11.1 and opentelemetry-proto v1.11.1, written as ingest/spec/openapi.json (ingest/spec/SOURCE.md); HyperDX's External API v2 document, packages/api/openapi.json at hyperdxio/hyperdx 049ec842 (api/spec/SOURCE.md)",
    description: "HyperDX twin: the OTLP/HTTP ingest its SDKs and OpenTelemetry exporters send to (binary and JSON protobuf), each span, log record and data point kept as its own record, and the External API v2's sources and search (searchEvents) reading those records as HyperDX's Logs and Traces sources answer them.",
    adoption: {
      sdks: ['@hyperdx/browser', '@opentelemetry/exporter-trace-otlp-http', '@opentelemetry/exporter-trace-otlp-proto', '@opentelemetry/exporter-logs-otlp-http', '@opentelemetry/exporter-logs-otlp-proto', '@opentelemetry/exporter-metrics-otlp-http', '@opentelemetry/exporter-metrics-otlp-proto', '@opentelemetry/sdk-node'],
      pypi: ['opentelemetry-exporter-otlp-proto-http'],
      envStems: ['HYPERDX'],
    },
    // The ingest host is the browser SDK's default collector URL; it sends traces to <url>/v1/traces and its session
    // replay to <url>/v1/logs.
    // source: archive:https://registry.npmjs.org/@hyperdx/browser/-/browser-0.24.0.tgz#sha256=5de7e9722245b6721303722a66e90f6ad4551329e930fa075351e112d963c1b8!/package/build/index.js "https://in-otel.hyperdx.io/v1/logs"
    // The API host is the one HyperDX's CLI reaches when no API URL is given (its v1 cloud API, and /api/v2 with
    // --apiVersion v2); a self-hosted HyperDX answers the same API at its own URL (HYPERDX_API_URL below).
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/cli/src/sourcemaps.ts "const backend = apiUrl || 'https://api.hyperdx.io';"
    hosts: [{ host: 'in-otel.hyperdx.io' }, { host: 'api.hyperdx.io' }],
    // source: https://opentelemetry.io/docs/specs/otel/protocol/exporter/ "When using OTEL_EXPORTER_OTLP_ENDPOINT , exporters MUST construct per-signal URLs as described below ."
    // source: https://opentelemetry.io/docs/specs/otel/protocol/exporter/ "OTEL_EXPORTER_OTLP_ENDPOINT is used as a base URL and the signals are sent"
    // Twenty's metric exporter reads its full URL from OTLP_COLLECTOR_METRICS_ENDPOINT_URL
    // source: https://raw.githubusercontent.com/twentyhq/twenty/1d561b8c73c984058a5121ec229f4805a2424a91/packages/twenty-server/src/instrument.ts "url: process.env.OTLP_COLLECTOR_METRICS_ENDPOINT_URL,"
    // LibreChat's browser RUM (HyperDX, its default provider) sends to RUM_URL, an http URL allowed on localhost
    // source: https://raw.githubusercontent.com/LibreChat-AI/LibreChat/f10b1d91f1eee3a2c82d5247bf620351486b7c1b/api/server/services/Config/rum.js "rumUrl = process.env.RUM_URL;"
    endpointEnv: {
      name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
      templates: { OTEL_EXPORTER_OTLP_ENDPOINT: '${url}', OTLP_COLLECTOR_METRICS_ENDPOINT_URL: '${url}/v1/metrics', RUM_URL: '${url}' },
      note: "Every OpenTelemetry SDK exporter reads OTEL_EXPORTER_OTLP_ENDPOINT as its base URL and appends v1/traces, v1/logs or v1/metrics, the ingest lane's paths; Twenty reads its metric exporter URL from OTLP_COLLECTOR_METRICS_ENDPOINT_URL, and LibreChat its HyperDX browser RUM base from RUM_URL.",
    },
    // source: https://opentelemetry.io/docs/specs/otel/protocol/exporter/ "When using OTEL_EXPORTER_OTLP_ENDPOINT , exporters MUST construct per-signal URLs as described below ."
    clientCasesNone: "The demanded applications reach HyperDX through OpenTelemetry's exporters and @hyperdx/browser only when their operators turn telemetry on (journeys/demand.json, optional), and its External API is read with plain HTTP; no official API client is used.",
    // Bootstrap: the World's team (its sign-up), its ingestion API key and the application's personal API key, the same at
    // every boot. LibreChat's browser RUM sends the ingestion key as its public token; HyperDX's CLI reads the personal
    // key and the API URL from these names.
    // source: https://raw.githubusercontent.com/LibreChat-AI/LibreChat/f10b1d91f1eee3a2c82d5247bf620351486b7c1b/api/server/services/Config/rum.js "if (!process.env.RUM_PUBLIC_TOKEN) {"
    // (its upload example passes the personal key as --serviceKey "$HYPERDX_API_ACCESS_KEY" and the URL as --apiUrl "$HYPERDX_API_URL")
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/cli/README.md "HYPERDX_API_ACCESS_KEY"
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/cli/README.md "HYPERDX_API_URL"
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/cli/src/sourcemaps.ts "if (process.env.HYPERDX_SERVICE_KEY) {"
    credentialDoor: { account: { field: 'account' }, path: '/_twin/app-credentials', body: {},
      fill: { RUM_PUBLIC_TOKEN: 'ingestion_key', HYPERDX_API_ACCESS_KEY: 'access_key', HYPERDX_SERVICE_KEY: 'access_key', HYPERDX_API_URL: 'api_url' },
    },
  },
};
