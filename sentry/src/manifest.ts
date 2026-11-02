// Sentry's manifest: a vendor of two APIs, each a lane (architecture, "Other wires: lanes"): the web API that sentry-cli
// and integrations call (`api`, from Sentry's OpenAPI document), and the ingestion endpoint every SDK sends its envelopes
// to (`ingest`, written from Sentry's SDK developer documentation). A DSN names its organization's ingest host
// (`o<id>.ingest[.<region>].sentry.io`); the API is sentry.io's, and a region's (us.sentry.io, de.sentry.io).
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'sentry',
  discovery: {
    twinOf: 'Sentry: the envelopes its SDKs send (errors, transactions, sessions, replays, profiles, cron check-ins, feedback, logs, metrics), and its web API for events, issues, releases and source maps',
    stores: 'organizations, projects and client keys, auth tokens (by their SHA-256), events and issues, and every other envelope item; releases and artifact bundles',
  },
  lanes: {
    routes: [
      { lane: 'ingest', host: '(^|\\.)ingest(\\.[a-z]+)?\\.sentry\\.io$' },
      { lane: 'api', host: '^([a-z]+\\.)?sentry\\.io$' },
    ],
    default: 'api',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-sentry',
    resources: ['organization', 'project', 'project_key', 'event', 'issue', 'release', 'monitor', 'check_in'],
    specSource: "Sentry's OpenAPI document (api/spec, sentry-api-schema 98ec014, patched with evidence) and its SDK developer documentation's envelope endpoint (ingest/spec)",
    description: 'Sentry twin — the envelope endpoint every SDK sends to (events grouped into issues, transactions, sessions, replays, profiles, check-ins, feedback, logs, metrics), and release and source-map APIs used by Cal.com and Rallly, account project/key setup, and core vendor-backed reads.',
    adoption: { sdks: ['@sentry/astro', '@sentry/browser', '@sentry/electron', '@sentry/nextjs', '@sentry/node', '@sentry/nestjs', '@sentry/react', '@sentry/react-native', '@sentry/remix', '@sentry/sveltekit', '@sentry/vue', '@sentry/cli'], pypi: ['sentry-sdk'], envStems: ['APPSMITHSENTRY', 'SENTRY'] },
    hosts: [{ host: 'sentry.io' }, { host: 'us.sentry.io' }, { host: 'de.sentry.io' }, { suffix: '.ingest.sentry.io' }, { suffix: '.ingest.us.sentry.io' }, { suffix: '.ingest.de.sentry.io' }],
    endpointEnvNone: "an SDK sends to its DSN's host and sentry-cli to SENTRY_URL (sentry.io by default); the DSN the World issues names the World's ingest host, claimed by the host rules",
    // Bootstrap: account sign-up, first credential and the project/key named by this env, stable at every boot.
    credentialDoor: { account: { field: 'account' },
      path: '/_twin/app-credentials', body: {},
      fill: {
        SENTRY_DSN: 'dsn', NEXT_PUBLIC_SENTRY_DSN: 'dsn', NEXT_PUBLIC_SENTRY_DSN_CLIENT: 'dsn', SENTRY_FRONT_DSN: 'dsn', SENTRY_DSN_API: 'dsn', VITE_SENTRY_DSN: 'dsn', EXPO_PUBLIC_SENTRY_DSN: 'dsn',
        SENTRY_AUTH_TOKEN: 'auth_token', SENTRY_ORG: 'org', SENTRY_ORGANIZATION: 'org', SENTRY_PROJECT: 'project',
      },
    },
  },
};
