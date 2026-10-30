// Polar's manifest: the vendor facts its spec does not carry (architecture, "Protocol 3", in twin-world). The surface is
// generated (./generated/surface.gen.json) from Polar's OpenAPI document (../spec/openapi.json.gz, 2026-04).
//
// THE CORE serves meters, individual stored product reads and the webhook endpoints' list. Handlers compose
// filtered answers and writes that make other resources (a checkout's confirmation).
// The served set is the demand's (../journeys/decisions.json); every other operation of a declared resource is
// `unmodeled`, the gap.
//
// WEBHOOKS: the kernel renders, signs and delivers (`events`); Polar's SDK verifies with Standard Webhooks keyed by the
// secret's own UTF-8 bytes (`validateEvent`: `Buffer.from(secret, "utf-8").toString("base64")`).
import type { DerivedManifest } from '@volter/world-core';
import { data, values } from './semantics/events.ts';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'polar',
  service: 'polar',
  tenant: { field: 'organization_id' },
  body: { json: 'always' },
  // every id Polar answers is `format: uuid4`
  ids: { template: '{uuid}' },
  time: 'iso',
  // spec ResourceNotFound, NotPermitted, Unauthorized: `{ error: <kind>, detail }`
  error: { error: '{code}', detail: '{message}' },
  readOnly: { status: 403, code: 'NotPermitted', message: 'This twin was started read-only; writes are refused.' },
  malformedBody: { status: 422, code: 'RequestValidationError', message: 'JSON decode error' },
  notFound: { status: 404, code: 'ResourceNotFound', message: 'Not found' },
  // a meter filtered by any operator but eq, which neither the biller's meters nor a published example use, is the gap
  variants: { 'meters:create': ['filter.clauses[].operator=ne', 'filter.clauses[].operator=gt', 'filter.clauses[].operator=gte', 'filter.clauses[].operator=lt', 'filter.clauses[].operator=lte', 'filter.clauses[].operator=like', 'filter.clauses[].operator=not_like', 'filter.clauses[].clauses[].operator=ne', 'filter.clauses[].clauses[].operator=gt', 'filter.clauses[].clauses[].operator=gte', 'filter.clauses[].clauses[].operator=lt', 'filter.clauses[].clauses[].operator=lte', 'filter.clauses[].clauses[].operator=like', 'filter.clauses[].clauses[].operator=not_like'] },
  // `{ items, pagination: { total_count, max_page } }`, 1-based `page`, `limit` 10 by default (spec: products:list)
  list: { style: 'envelope', envelope: { items: '{data}', pagination: { total_count: '{total_count}', max_page: '{max_page}' } }, limit: { param: 'limit', default: 10, max: 100 }, page: { param: 'page', link: false } },
  deleted: {},
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: false, invalidKeys: [],
    // spec securitySchemes: `oat` and `pat` are bearer tokens; the front (./semantics/around.ts) checks each operation's
    // credential by what its security names, so the kernel's gate lets every request through to it
    missing: { status: 401, code: 'Unauthorized', message: 'Unauthorized' },
    invalid: { status: 401, code: 'Unauthorized', message: 'Unauthorized' },
  },
  events: {
    scheme: { kind: 'webhook-id', prefix: 'webhook', secretKey: 'utf8' },
    types: {
      'checkout.create': 'checkout.created', 'order.create': 'order.created', 'order.pay': 'order.paid', 'order.refund': 'order.refunded',
    },
    // source: spec:/components/schemas/WebhookOrderPaidPayload "Sent when an order is paid."
    envelope: { type: '$type', timestamp: '$time.iso', data: '$data' },
    endpoints: { storedAs: 'webhook_endpoint', url: 'url', secret: 'secret', filter: 'events', enabled: 'enabled', match: { _environment: '$environment', format: 'raw' } },
    record: '_webhook_delivery',
    render: data, values,
  },
  // Operations of declared resources outside the implemented decision table remain the gap.
  unmodeled: [
    'checkouts:update', 'meters:get', 'meters:update', 'orders:create', 'orders:update',
    'products:update', 'products:update_benefits',
    'subscriptions:create', 'subscriptions:revoke',
    'webhooks:get_webhook_endpoint', 'webhooks:update_webhook_endpoint', 'webhooks:delete_webhook_endpoint',
  ],
  // a vendor-backed World's root: Polar's webhooks sent to the World's ingest door, signed as every Polar event is
  // (Standard Webhooks, as `events.scheme`), each naming its type in `type` and carrying its object at `data`
  // source: spec:/components/schemas/WebhookOrderPaidPayload "Sent when an order is paid."
  ingest: {
    scheme: { kind: 'webhook-id', prefix: 'webhook', secretKey: 'utf8' },
    type: { body: 'type' },
    object: 'data',
    types: {
      'customer.created': { resource: 'customer' }, 'customer.updated': { resource: 'customer' }, 'customer.deleted': { resource: 'customer', deleted: true },
      'product.created': { resource: 'Product' }, 'product.updated': { resource: 'Product' },
      'checkout.created': { resource: 'Checkout' }, 'checkout.updated': { resource: 'Checkout' },
      'order.created': { resource: 'Order' }, 'order.paid': { resource: 'Order' }, 'order.updated': { resource: 'Order' }, 'order.refunded': { resource: 'Order' },
      'subscription.created': { resource: 'Subscription' }, 'subscription.active': { resource: 'Subscription' }, 'subscription.updated': { resource: 'Subscription' },
      'subscription.canceled': { resource: 'Subscription' }, 'subscription.uncanceled': { resource: 'Subscription' }, 'subscription.revoked': { resource: 'Subscription' },
    },
  },
  // the fail-closed ceiling on live calls against Polar (world-core rateBudget.ts, architecture D8): the sandbox's limit,
  // the lower of the two Polar documents, a fifth of production's
  // source: https://polar.sh/docs/api-reference/introduction "500 requests per minute"
  // source: https://polar.sh/docs/api-reference/introduction "100 requests per minute"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 100, source: 'https://polar.sh/docs/api-reference/introduction' },
    windowMs: 60_000, ceiling: 90, defaultWeight: 1, maxRetryAfterSeconds: 300, rules: [],
    reason: 'Polar documents 500 requests a minute per organization, customer or OAuth2 client in production and 100 in the sandbox, answering 429 with Retry-After over it (polar.sh/docs/api-reference/introduction, Rate Limits); 90 a minute stays under the sandbox\'s limit.',
  },
  // GET /twin: what the twin is of and what it keeps
  discovery: {
    twinOf: "Polar (api.polar.sh) as Volter's billing and Open Autonomy's patronage call it: meters and products, checkouts paid on the hosted checkout page and read back, the orders they make, customers and their state by the application's own id, customer sessions for the portal, usage events, and the signed webhooks of an organization's endpoints",
    stores: "the organization's meters and products, customers, checkouts and the subscriptions and orders they make, usage events, customer sessions, webhook endpoints, and the webhooks it sent",
  },
  doors: [
    { id: 'accessTokens', method: 'POST', path: '/_twin/access-tokens', note: '{ comment, expires_in_days? }: an Organization Access Token made on the settings page (shown once)' },
    { id: 'revokeToken', method: 'DELETE', path: '/_twin/access-tokens/{n}', note: 'a token revoked on the settings page' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: 'the access token an application holds, as the runtime issues it' },
    { id: 'deliveries', method: 'GET', path: '/_twin/deliveries', note: '?to=<url>&type=<event>: every webhook Polar sent, in order, as the receiving server got it' },
  ],
  screens: [
    { id: 'checkout', kind: 'flow', host: 'buy.polar.sh', path: '/{client_secret}', demand: "every checkout an application sends a customer to (Twin's biller, Open Autonomy's patronage)", status: 'done', controls: ['email', 'pay'], source: 'https://polar.sh/docs/features/checkout/session' },
    { id: 'portal', kind: 'flow', host: 'polar.sh', path: '/{slug}/portal', demand: "a customer session's customer_portal_url (Twin's biller, Manage billing)", status: 'done', controls: [], source: 'https://polar.sh/docs/features/customer-portal' },
  ],
  resources: {
    _access_token: { idPrefix: 'oat_', ids: '{prefix}{n}' },
    _customer_meter: { idPrefix: '', ids: '{uuid}' },
    _order_item: { idPrefix: '', ids: '{uuid}' },
    _refund: { idPrefix: '', ids: '{uuid}' },
    _event_key: { idPrefix: 'event_key_' },
    _price: { idPrefix: '', ids: '{uuid}' },
    _seq_order: { idPrefix: '', ids: '{n}' },
    // the stored types the handlers make, declared so their ids are minted (ctx.mint)
    customer: { orderBy: { param: 'sorting', default: '-created_at', fields: ['created_at'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, idPrefix: '', refresh: { list: 'customers:list', items: 'items' } },
    Product: { storedAs: 'product', ...states.Product, orderBy: { param: 'sorting', default: '-created_at', fields: ['created_at'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, idPrefix: '', refresh: { list: 'products:list' } },
    event: { orderBy: { param: 'sorting', default: '-timestamp', fields: ['timestamp'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, idPrefix: '', refresh: { list: 'events:list', items: 'items' } },
    customer_session: { idPrefix: '', refresh: { none: "a customer session is a token answered once, by its create; the API lists none and reads none back" } },
    // a meter as the spec's Meter requires it: what the server assigns beside what the request gives
    Meter: { orderBy: { param: 'sorting', default: '-created_at', fields: ['created_at', 'name'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } },
      storedAs: 'meter', idPrefix: '', ...states.Meter, filters: ['name'], order: { field: 'created_at', direction: 'desc' }, refresh: { list: 'meters:list' },
      // source: spec:/components/schemas/MeterCreate/properties/unit "scalar"
      assigned: { unit: { value: 'scalar' }, created_at: { now: true }, modified_at: { value: null }, archived_at: { value: null }, metadata: { value: {} } },
    },
    WebhookEndpoint: { orderBy: { param: 'sorting', default: '-created_at', fields: ['created_at'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, storedAs: 'webhook_endpoint', idPrefix: '', ...states.WebhookEndpoint, order: { field: 'created_at', direction: 'desc' }, refresh: { list: 'webhooks:list_webhook_endpoints' } },
    Checkout: { orderBy: { param: 'sorting', default: '-created_at', fields: ['created_at'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, storedAs: 'checkout', idPrefix: '', ...states.Checkout, refresh: { list: 'checkouts:list' } },
    Subscription: { orderBy: { param: 'sorting', default: '-started_at', fields: ['started_at'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, storedAs: 'subscription', idPrefix: '', ...states.Subscription, refresh: { list: 'subscriptions:list' } },
    Order: { orderBy: { param: 'sorting', default: '-created_at', fields: ['created_at'], invalid: { status: 422, code: 'RequestValidationError', message: 'Invalid sorting criterion' } }, storedAs: 'order', idPrefix: '', ...states.Order, refresh: { list: 'orders:list' } },
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest, surface)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-polar',
    resources: ['customer', 'product', 'checkout', 'subscription', 'order', 'event', 'meter', 'customer_session', 'webhook_endpoint'],
    specSource: 'Polar\'s OpenAPI document, 2026-04 (spec/openapi.json.gz, provenance in spec/SOURCE.md)',
    description: 'Polar twin — meters and products with their prices, checkouts with the hosted checkout page, the orders and subscriptions a paid checkout makes, customers and their state (subscriptions and meters) by the application\'s own id, customer sessions, usage events, webhook endpoints, and webhooks signed as Polar\'s SDK verifies them.',
    adoption: { sdks: ['@polar-sh/sdk'], pypi: ['polar-sdk'], scopes: ['@polar-sh/'], envStems: ['POLAR'] },
    // a World's applications hold an Organization Access Token the settings page made; the API refuses any other
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { POLAR_ACCESS_TOKEN: 'access_token', POLAR_API_KEY: 'access_token', POLAR_ORGANIZATION_TOKEN: 'access_token' } },
    // the API (production and sandbox) and the hosted checkout
    hosts: [{ host: 'api.polar.sh' }, { host: 'sandbox-api.polar.sh' }, { host: 'buy.polar.sh' }, { host: 'polar.sh', pathPattern: '^/[^/]+/portal' }, { host: 'sandbox.polar.sh' }],
    endpointEnvNone: '@polar-sh/sdk reads no base-URL variable: its `server` option picks production or sandbox, both claimed by the host rules.',
  },
};
