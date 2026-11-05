// The ingest lane's manifest: the vendor facts its spec (../spec, written from Sentry's SDK developer docs) does not
// carry. Every SDK sends what it captures here, as envelopes (./semantics/api.ts); the envelope authenticates itself
// by its DSN's public key, so there is no manifest `auth`.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'sentry',
  // one service with the API lane (../../api/src/manifest.ts), so one store
  service: 'sentry',
  hosts: [{ suffix: '.ingest.sentry.io' }, { suffix: '.ingest.us.sentry.io' }, { suffix: '.ingest.de.sentry.io' }],
  // source: spec:/servers/0/url "https://o0.ingest.us.sentry.io"
  remoteHost: { template: 'o0.ingest.us.sentry.io' },
  // an envelope is not JSON: its bytes are kept (./semantics/around.ts) and read by the handler
  body: {},
  // source: https://raw.githubusercontent.com/getsentry/sentry-docs/3ec4e139711af82b38a3c2c17261f5f5cdb66dfc/develop-docs/sdk/foundations/transport/compression.mdx "The following content encodings are accepted by Relay and Sentry:"
  // The kernel decodes the declared vendor encodings before the handler reads the retained bytes.
  encodings: { request: ['gzip', 'deflate', 'br', 'zstd'], undecodable: { status: 400, message: 'failed to read request body' } },
  ids: { template: '{uuid}' },
  time: 'iso',
  // Relay's error body: `{"detail": ..., "causes": [...]}` (develop-docs/sdk/foundations/transport/index.mdx)
  error: { detail: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; envelopes are refused.' },
  malformedBody: { status: 400, message: 'failed to read request body' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  deleted: {},
  // a browser SDK posts cross-origin: every answer allows any origin and exposes what an SDK reads of it
  // (transport/rate-limiting.mdx: Retry-After, X-Sentry-Rate-Limits). Where the documentation stops: Relay's CORS is its
  // code's, not a page's; the headers allowed are the ones the SDKs' transports send
  cors: {
    origin: '*',
    methods: 'GET, POST, OPTIONS',
    headers: 'x-sentry-auth, x-requested-with, x-forwarded-for, origin, referer, accept, content-type, authentication, authorization, content-encoding, transfer-encoding, sentry-trace, baggage',
    expose: 'x-sentry-error, x-sentry-rate-limits, retry-after',
    maxAge: 3600,
  },
  // the sequences the vendor numbers by (ctx.issue over each, src/semantics/shared.ts next)
  // All stored vendor resources are owned and refreshed by the API manifest through ctx.over.
  resources: {},
  vendorBacked: { none: 'Envelope receipt is telemetry ingestion, never deployed as account changes. The API manifest owns and refreshes its resulting vendor resources.' },
  discovery: { twinOf: "Sentry's ingestion endpoint (Relay): the envelopes every SDK sends", stores: 'events and their issues, transactions, sessions, client reports, attachments, replays, profiles, cron check-ins and monitors, logs, metrics and spans' },
};
