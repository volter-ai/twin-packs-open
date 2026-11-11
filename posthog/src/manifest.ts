// PostHog's manifest: a vendor of two APIs, each a lane: capture (`ingest`, the project-token endpoints its SDKs send
// events to) and the private API (`api`, read with a personal API key). Both are one service, so one store.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'posthog',
  discovery: { twinOf: "PostHog: the events its SDKs capture with their person effects, and its private API's events and persons reads and person erasure", stores: 'events as sent, persons with their distinct ids and properties, projects and personal API keys (by their SHA-256)' },
  lanes: {
    routes: [
      { lane: 'ingest', host: '^(us|eu)(-assets)?\\.i\\.posthog\\.com$' },
      { lane: 'ingest', path: '/i/v0' }, { lane: 'ingest', path: '/e' }, { lane: 'ingest', path: '/batch' }, { lane: 'ingest', path: '/capture' },
      { lane: 'ingest', path: '/track' }, { lane: 'ingest', path: '/s' }, { lane: 'ingest', path: '/flags' }, { lane: 'ingest', path: '/decide' },
      { lane: 'ingest', path: '/array' },
    ],
    default: 'api',
  },
  // The fail-closed ceiling on live calls against PostHog (world-core rateBudget.ts, architecture D8), inside its
  // documented limits, which apply to the whole organization: the create, read, update and delete endpoints take 480 a
  // minute and 4,800 an hour, the analytics endpoints (persons among them) 240 a minute and 1,200 an hour, the query
  // endpoint 2,400 an hour; capture and flags have no request-level limit. 1,000 calls an hour (the kernel's largest
  // ceiling) is under the lowest hourly limit, the analytics endpoints' 1,200, and 240 a minute their burst.
  // source: https://posthog.com/docs/api "For the rest of the create, read, update, and delete endpoints, the rate limits are 480/minute and 4800/hour ."
  // source: https://posthog.com/docs/api "For all analytics endpoints (such as calculating insights, retrieving persons, or retrieving session recordings), the rate limits are 240/minute and 1200/hour ."
  // source: https://posthog.com/docs/api "The query endpoint has a rate limit of 2400/hour ."
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 480, source: 'https://posthog.com/docs/api' },
    windowMs: 3_600_000,
    ceiling: 1000,
    burstCeiling: 240,
    defaultWeight: 1,
    maxRetryAfterSeconds: 300,
    reason:
      "PostHog's API page (read 2026-10-02): CRUD endpoints 480/minute and 4800/hour, analytics endpoints (persons) " +
      '240/minute and 1200/hour, the query endpoint 2400/hour, organization-wide; capture and flags unlimited. 1000 calls ' +
      'an hour stays under the lowest hourly limit (1200) and 240 a minute is the analytics burst.',
  },
  // What of PostHog's records identifies a person (twin-world architecture, "Replicating an issue"), by stored type and
  // path, from the shapes the lanes keep: an event its distinct id and properties as captured (and the SDK's payload
  // whole, `_payload`), a person their properties and distinct ids, a distinct id's link. The person properties an event
  // sets (`$set`, `$set_once`) are the person's. Every act time is declared, so one offset moves them all.
  privacy: {
    identifiers: {
      event: {
        distinct_id: 'id',
        'properties.distinct_id': 'id', 'properties.$distinct_id': 'id', 'properties.$anon_distinct_id': 'id', 'properties.$device_id': 'id', 'properties.alias': 'id', 'properties.email': 'email', 'properties.name': 'name', 'properties.$ip': 'ip', 'properties.$current_url': 'url', 'properties.$referrer': 'url', 'properties.$initial_referrer': 'url', 'properties.$initial_current_url': 'url', 'properties.$prev_pageview_url': 'url', 'properties.$raw_user_agent': 'agent', 'properties.$geoip_city_name': 'place', 'properties.$geoip_subdivision_1_name': 'place', 'properties.$geoip_subdivision_2_name': 'place', 'properties.$geoip_postal_code': 'place', 'properties.$geoip_latitude': 'place', 'properties.$geoip_longitude': 'place',
        'properties.$set.email': 'email', 'properties.$set.name': 'name', 'properties.$set.$geoip_city_name': 'place', 'properties.$set.$geoip_subdivision_1_name': 'place', 'properties.$set.$geoip_postal_code': 'place', 'properties.$set.$geoip_latitude': 'place', 'properties.$set.$geoip_longitude': 'place', 'properties.$set.$initial_current_url': 'url', 'properties.$set.$initial_referrer': 'url', 'properties.$set.$current_url': 'url', 'properties.$set.$initial_geoip_city_name': 'place', 'properties.$set.$initial_geoip_subdivision_1_name': 'place', 'properties.$set.$initial_geoip_postal_code': 'place', 'properties.$set.$initial_geoip_latitude': 'place', 'properties.$set.$initial_geoip_longitude': 'place',
        'properties.$set_once.email': 'email', 'properties.$set_once.name': 'name', 'properties.$set_once.$geoip_city_name': 'place', 'properties.$set_once.$geoip_subdivision_1_name': 'place', 'properties.$set_once.$geoip_postal_code': 'place', 'properties.$set_once.$geoip_latitude': 'place', 'properties.$set_once.$geoip_longitude': 'place', 'properties.$set_once.$initial_current_url': 'url', 'properties.$set_once.$initial_referrer': 'url', 'properties.$set_once.$current_url': 'url', 'properties.$set_once.$initial_geoip_city_name': 'place', 'properties.$set_once.$initial_geoip_subdivision_1_name': 'place', 'properties.$set_once.$initial_geoip_postal_code': 'place', 'properties.$set_once.$initial_geoip_latitude': 'place', 'properties.$set_once.$initial_geoip_longitude': 'place',
        '_payload.distinct_id': 'id',
        '_payload.properties.distinct_id': 'id', '_payload.properties.$distinct_id': 'id', '_payload.properties.$anon_distinct_id': 'id', '_payload.properties.$device_id': 'id', '_payload.properties.alias': 'id', '_payload.properties.email': 'email', '_payload.properties.name': 'name', '_payload.properties.$ip': 'ip', '_payload.properties.$current_url': 'url', '_payload.properties.$referrer': 'url', '_payload.properties.$initial_referrer': 'url', '_payload.properties.$initial_current_url': 'url', '_payload.properties.$prev_pageview_url': 'url', '_payload.properties.$raw_user_agent': 'agent', '_payload.properties.$geoip_city_name': 'place', '_payload.properties.$geoip_subdivision_1_name': 'place', '_payload.properties.$geoip_subdivision_2_name': 'place', '_payload.properties.$geoip_postal_code': 'place', '_payload.properties.$geoip_latitude': 'place', '_payload.properties.$geoip_longitude': 'place',
        '_payload.$set.email': 'email', '_payload.$set.name': 'name', '_payload.$set.$geoip_city_name': 'place', '_payload.$set.$geoip_subdivision_1_name': 'place', '_payload.$set.$geoip_postal_code': 'place', '_payload.$set.$geoip_latitude': 'place', '_payload.$set.$geoip_longitude': 'place', '_payload.$set.$initial_current_url': 'url', '_payload.$set.$initial_referrer': 'url', '_payload.$set.$current_url': 'url', '_payload.$set.$initial_geoip_city_name': 'place', '_payload.$set.$initial_geoip_subdivision_1_name': 'place', '_payload.$set.$initial_geoip_postal_code': 'place', '_payload.$set.$initial_geoip_latitude': 'place', '_payload.$set.$initial_geoip_longitude': 'place',
        '_payload.$set_once.email': 'email', '_payload.$set_once.name': 'name', '_payload.$set_once.$geoip_city_name': 'place', '_payload.$set_once.$geoip_subdivision_1_name': 'place', '_payload.$set_once.$geoip_postal_code': 'place', '_payload.$set_once.$geoip_latitude': 'place', '_payload.$set_once.$geoip_longitude': 'place', '_payload.$set_once.$initial_current_url': 'url', '_payload.$set_once.$initial_referrer': 'url', '_payload.$set_once.$current_url': 'url', '_payload.$set_once.$initial_geoip_city_name': 'place', '_payload.$set_once.$initial_geoip_subdivision_1_name': 'place', '_payload.$set_once.$initial_geoip_postal_code': 'place', '_payload.$set_once.$initial_geoip_latitude': 'place', '_payload.$set_once.$initial_geoip_longitude': 'place',
        '_payload.properties.$set.email': 'email', '_payload.properties.$set.name': 'name', '_payload.properties.$set.$geoip_city_name': 'place', '_payload.properties.$set.$geoip_subdivision_1_name': 'place', '_payload.properties.$set.$geoip_postal_code': 'place', '_payload.properties.$set.$geoip_latitude': 'place', '_payload.properties.$set.$geoip_longitude': 'place', '_payload.properties.$set.$initial_current_url': 'url', '_payload.properties.$set.$initial_referrer': 'url', '_payload.properties.$set.$current_url': 'url', '_payload.properties.$set.$initial_geoip_city_name': 'place', '_payload.properties.$set.$initial_geoip_subdivision_1_name': 'place', '_payload.properties.$set.$initial_geoip_postal_code': 'place', '_payload.properties.$set.$initial_geoip_latitude': 'place', '_payload.properties.$set.$initial_geoip_longitude': 'place',
        '_payload.properties.$set_once.email': 'email', '_payload.properties.$set_once.name': 'name', '_payload.properties.$set_once.$geoip_city_name': 'place', '_payload.properties.$set_once.$geoip_subdivision_1_name': 'place', '_payload.properties.$set_once.$geoip_postal_code': 'place', '_payload.properties.$set_once.$geoip_latitude': 'place', '_payload.properties.$set_once.$geoip_longitude': 'place', '_payload.properties.$set_once.$initial_current_url': 'url', '_payload.properties.$set_once.$initial_referrer': 'url', '_payload.properties.$set_once.$current_url': 'url', '_payload.properties.$set_once.$initial_geoip_city_name': 'place', '_payload.properties.$set_once.$initial_geoip_subdivision_1_name': 'place', '_payload.properties.$set_once.$initial_geoip_postal_code': 'place', '_payload.properties.$set_once.$initial_geoip_latitude': 'place', '_payload.properties.$set_once.$initial_geoip_longitude': 'place',
        'person.distinct_ids': 'id',
        'person.properties.email': 'email', 'person.properties.name': 'name', 'person.properties.$geoip_city_name': 'place', 'person.properties.$geoip_subdivision_1_name': 'place', 'person.properties.$geoip_postal_code': 'place', 'person.properties.$geoip_latitude': 'place', 'person.properties.$geoip_longitude': 'place', 'person.properties.$initial_current_url': 'url', 'person.properties.$initial_referrer': 'url', 'person.properties.$current_url': 'url', 'person.properties.$initial_geoip_city_name': 'place', 'person.properties.$initial_geoip_subdivision_1_name': 'place', 'person.properties.$initial_geoip_postal_code': 'place', 'person.properties.$initial_geoip_latitude': 'place', 'person.properties.$initial_geoip_longitude': 'place',
        timestamp: 'time', '_payload.timestamp': 'time', _sent_at: 'time', _received: 'time', created_at: 'time',
      },
      person: {
        distinct_ids: 'id',
        'properties.email': 'email', 'properties.name': 'name', 'properties.$geoip_city_name': 'place', 'properties.$geoip_subdivision_1_name': 'place', 'properties.$geoip_postal_code': 'place', 'properties.$geoip_latitude': 'place', 'properties.$geoip_longitude': 'place', 'properties.$initial_current_url': 'url', 'properties.$initial_referrer': 'url', 'properties.$current_url': 'url', 'properties.$initial_geoip_city_name': 'place', 'properties.$initial_geoip_subdivision_1_name': 'place', 'properties.$initial_geoip_postal_code': 'place', 'properties.$initial_geoip_latitude': 'place', 'properties.$initial_geoip_longitude': 'place',
        'properties.$ip': 'ip', 'properties.$raw_user_agent': 'agent',
        created_at: 'time', _last_seen_at: 'time', last_seen_at: 'time',
      },
      person_distinct_id: { distinct_id: 'id' },
      _event_deletion: { distinct_ids: 'id', queued_at: 'time', due: 'time' },
    },
    // the counts a developer asks of an incident, none grouped by what identifies a person
    questions: [
      { type: 'event' }, { type: 'event', by: 'event' }, { type: 'event', by: 'properties.$lib' }, { type: 'event', by: 'properties.$browser' }, { type: 'event', by: 'properties.$os' },
      { type: 'person' }, { type: 'person', by: 'properties.$geoip_country_code' }, { type: 'person', by: 'is_identified' },
    ],
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-posthog',
    resources: ['event', 'person'],
    specSource: "PostHog's OpenAPI document (api/spec, fetched 2026-09-30, the person delete patched in) and its public endpoints written from the capture service and the docs (ingest/spec)",
    description: 'PostHog twin: capture (batch, capture, e, i/v0/e) storing events as sent with identify, alias and person property effects, and the private API reading events and persons and deleting a person with its events queued.',
    adoption: { sdks: ['posthog-js', 'posthog-node'], envStems: ['POSTHOG'] },
    // source: https://posthog.com/docs/libraries/node "the official posthog-node library is the simplest way to integrate your software with PostHog"
    // Official posthog-node cases live in twin-world/packages/twin-standard/src/clients/posthog.ts.
    hosts: [{ host: 'us.i.posthog.com' }, { host: 'eu.i.posthog.com' }, { host: 'us-assets.i.posthog.com' }, { host: 'eu-assets.i.posthog.com' }, { host: 'us.posthog.com' }, { host: 'eu.posthog.com' }, { host: 'app.posthog.com' }],
    endpointEnvNone: 'The SDKs accept host options; no base-URL environment variable belongs to the SDK itself.',
    // source: https://posthog.com/docs/libraries/node "the official posthog-node library is the simplest way to integrate your software with PostHog"
    clientCasesNone: 'No demanded application uses PostHog or its SDKs in its default configuration; Cal and Rallly integrations require opt-in, and the World bench drives Rallly through its own posthog-node.',
    // Bootstrap: the account's sign-up, its project, project token and personal API key, stable at every boot.
    credentialDoor: { account: { field: 'account' }, path: '/_twin/app-credentials', body: {},
      fill: {
        NEXT_PUBLIC_POSTHOG_API_KEY: 'project_token', NEXT_PUBLIC_POSTHOG_KEY: 'project_token', POSTHOG_API_KEY: 'project_token', POSTHOG_KEY: 'project_token',
        NEXT_PUBLIC_POSTHOG_API_HOST: 'ingest_host', NEXT_PUBLIC_POSTHOG_HOST: 'ingest_host', POSTHOG_HOST: 'ingest_host',
        POSTHOG_PERSONAL_API_KEY: 'personal_api_key', POSTHOG_PROJECT_ID: 'project_id', POSTHOG_API_HOST: 'api_host',
      },
    },
  },
};
