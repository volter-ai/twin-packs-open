// Resend's manifest: the vendor facts its published document does not carry (docs/contributing/architecture.md,
// "Protocol 3"). The surface is generated (./generated/surface.gen.json, from ../spec: Resend's OpenAPI document, with
// ../spec/patches.json's corrections).
//
// SCOPE FROM THE DEMAND (../journeys/demand.json):
// - emails sent singly and in batches (Dub, Twenty, Postiz, Twin), a sent email read (Twenty), the team's sent emails
//   listed (Twin's platform reads its mail back; a vendor-backed root refreshes them);
// - sending domains created, read, listed, updated, verified and removed (Dub, Twenty, the Postiz cookbook's seed);
// - a received email read, and its raw message downloaded (Twenty);
// - the webhooks the applications take: email.sent, delivered, bounced, opened, complained and received (Dub, Twenty).
// Handlers serve each (./semantics); every other operation (broadcasts, segments, topics, audiences and contacts, the
// keys and webhooks APIs, contact properties, imports) is the gap, those the core could serve named in `unmodeled`.
//
// THE STATE: API keys (kept by their SHA-256, made on the API Keys page: a World door), domains and the records at their
// owners' DNS hosts, emails and their lifecycle (a recipient's server takes or refuses them, a recipient opens or
// complains: doors), received emails, and webhook endpoints (made on the Webhooks page: a door) and what was sent to
// them.
//
// WHY NO `auth`: an unknown key is refused 400 and a deleted one 403 in Resend's envelope, which the kernel's gate
// cannot state; the front (./semantics/around.ts) checks every request's key.
import type { DerivedManifest } from '@volter/world-core';
import { data, values } from './semantics/events.ts';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'resend',
  service: 'resend',
  body: { json: 'always' },
  // Resend's ids are UUIDs (https://resend.com/docs/api-reference/emails/retrieve-email)
  ids: { template: '{uuid}' },
  time: 'iso',
  // https://resend.com/docs/api-reference/errors: { statusCode, name, message }
  error: { statusCode: '{status}', name: '{code}', message: '{message}' },
  defaultKind: 'validation_error',
  readOnly: { status: 405, code: 'method_not_allowed', message: 'Method is not allowed for the requested path.' },
  malformedBody: { status: 422, code: 'validation_error', message: 'The request body is not valid JSON.' },
  notFound: { status: 404, code: 'not_found', message: 'The requested endpoint does not exist.' },
  gap: { status: 404, code: 'not_found', message: 'The requested endpoint does not exist.' },
  // a list's pages: `limit` (at most 100) and the next page `after` the last item's id
  // source: spec:/components/parameters/PaginationAfter "Return items after this cursor."
  list: { style: 'envelope', envelope: { object: 'list', has_more: '{has_more}', data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 }, after: 'after' },
  // the audience-scoped contact paths the SDK keeps (../spec/patches.json): no application here calls them
  unmodeled: ['audiences/create-contact', 'audiences/remove-contact'],
  deleted: { object: '{object}', id: '{id}', deleted: true },
  // https://resend.com/docs/webhooks/verify-webhooks-requests: svix-id, svix-timestamp, svix-signature (v1,<base64>)
  events: {
    scheme: { kind: 'webhook-id', prefix: 'svix', secretPrefix: 'whsec_' },
    headers: { 'content-type': 'application/json' },
    types: { 'email.send': 'email.sent', 'email.deliver': 'email.delivered', 'email.bounce': 'email.bounced', 'email.open': 'email.opened', 'email.click': 'email.clicked', 'email.complain': 'email.complained', 'email.receive': 'email.received' },
    envelope: { type: '$type', created_at: '$time.iso', data: '$data' },
    render: data,
    values,
    // an endpoint takes its own team's events
    endpoints: { storedAs: '_webhook', url: 'endpoint', secret: 'signing_secret', filter: 'events', status: { field: 'status', live: 'enabled' }, match: { _team: '$team' } },
    record: '_webhook_delivery',
  },
  doors: [
    { id: 'keys', method: 'POST', path: '/_twin/api-keys', note: '{ name }: a full-access key, as the API Keys page makes it (shown once)' },
    { id: 'removeKey', method: 'DELETE', path: '/_twin/api-keys/{id}', note: 'a key deleted on the API Keys page' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: 'the key the World\'s application holds, as the runtime issues it at every boot' },
    { id: 'webhooks', method: 'POST', path: '/_twin/webhooks', note: '{ endpoint, events }: an endpoint added on the Webhooks page, its signing secret answered' },
    { id: 'dns', method: 'POST', path: '/_twin/dns', note: '{ name, type, value }: a record the domain\'s owner sets at their DNS host' },
    { id: 'recipients', method: 'POST', path: '/_twin/recipients/{domain}', note: '{ rejects }: whether an outside mail server refuses mail for its domain' },
    { id: 'open', method: 'POST', path: '/_twin/mail/{email_id}/open', note: '{ to }: the recipient opens the email' },
    { id: 'complain', method: 'POST', path: '/_twin/mail/{email_id}/complain', note: '{ to }: the recipient marks it as spam' },
    { id: 'inbound', method: 'POST', path: '/_twin/inbound', note: '{ from, to, subject, text, html? }: mail sent from outside to an address at a receiving domain' },
    { id: 'mail', method: 'GET', path: '/_twin/mail', note: '?to=<address>: what reached that address\'s inbox' },
    { id: 'deliveries', method: 'GET', path: '/_twin/deliveries', note: '?to=<url>[&type=][&email=]: the webhooks Resend sent there, oldest first' },
  ],
  screens: [{
    id: 'inbound-cdn', kind: 'content', host: 'inbound-cdn.resend.com', path: '/',
    demand: "Twenty downloads a received email's raw message at its pre-signed URL", status: 'done',
    source: 'https://resend.com/docs/api-reference/emails/retrieve-received-email',
  }],
  // a vendor-backed World's root: the team's webhook endpoint at the World's ingest door, signed as Resend signs every
  // webhook (svix-id, svix-timestamp, svix-signature: the kernel's webhook-id scheme). An email event carries the email's
  // id as email_id and its new status in its type; the email types Dub and Twenty handle are each folded so, a received
  // email as the received email it names. Domain events (domain.created, updated, deleted) carry the domain itself.
  // source: https://resend.com/docs/webhooks/verify-webhooks-requests "svix-signature"
  // source: spec:/components/schemas/OutboundEmailEventData/properties/email_id "Unique identifier for the email."
  // source: spec:/components/schemas/EmailReceivedEventData/properties/email_id "Unique identifier for the email."
  // source: spec:/components/schemas/Email/properties/last_event "The status of the email."
  // source: spec:/components/schemas/EmailDeliveredEvent/properties/type "The event type."
  // source: spec:/components/schemas/EmailBouncedEvent/properties/type "The event type."
  // source: spec:/components/schemas/EmailOpenedEvent/properties/type "The event type."
  // source: spec:/components/schemas/EmailComplainedEvent/properties/type "The event type."
  // source: spec:/components/schemas/EmailFailedEvent/properties/type "The event type."
  // source: spec:/components/schemas/EmailReceivedEvent/properties/type "The event type."
  ingest: {
    scheme: { kind: 'webhook-id', prefix: 'svix', secretPrefix: 'whsec_' },
    type: { body: 'type' }, object: 'data',
    types: {
      'email.delivered': { resource: 'email', id: 'email_id', fields: { last_event: 'delivered' } },
      'email.bounced': { resource: 'email', id: 'email_id', fields: { last_event: 'bounced' } },
      'email.opened': { resource: 'email', id: 'email_id', fields: { last_event: 'opened' } },
      'email.complained': { resource: 'email', id: 'email_id', fields: { last_event: 'complained' } },
      'email.failed': { resource: 'email', id: 'email_id', fields: { last_event: 'failed' } },
      'email.received': { resource: 'GetReceivedEmailResponse', id: 'email_id' },
    },
  },
  // the fail-closed ceiling on live calls against Resend (world-core rateBudget.ts, architecture D8): a fifth of the
  // team's documented per-minute allowance, which every key of the team shares
  // source: https://resend.com/docs/api-reference/rate-limit "10 requests per second per team"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 600, source: 'https://resend.com/docs/api-reference/rate-limit' },
    reason: "Resend's default limit is 10 requests a second per team, across all its API keys, answering 429 with retry-after over it (https://resend.com/docs/api-reference/rate-limit); the World allows 120 requests in a fixed minute window",
    windowMs: 60_000, ceiling: 120, defaultWeight: 1, maxRetryAfterSeconds: 300,
  },
  discovery: { twinOf: 'the Resend email API', stores: 'API keys, domains, sent and received emails, webhook endpoints and deliveries' },
  resources: {
    // keyed by their stored names: every served operation is a handler
    email: { idPrefix: '', ...states.email, refresh: { list: 'emails/list', detail: 'emails/get' } },
    domain: { idPrefix: '', ...states.domain, refresh: { list: 'domains/list', detail: 'domains/get' } },
    _api_key: { idPrefix: '', ...states._api_key },
    // source: spec:emails/get-receiving "Retrieve a single received email"
    GetReceivedEmailResponse: { idPrefix: '', storedAs: 'received', refresh: { list: 'emails/list-receiving', items: 'data', detail: 'emails/get-receiving' } },
    _webhook: { idPrefix: '' },
    _attachment_id: { idPrefix: '' },
    _webhook_delivery: { idPrefix: '' },
    _dns: { idPrefix: '' },
    _recipient_domain: { idPrefix: '' },
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-resend',
    resources: ['email', 'domain', 'received'],
    specSource: "Resend's OpenAPI document (spec/, provenance in spec/SOURCE.md)",
    description: 'Resend email API twin — emails sent singly and in batches and their lifecycle, sending domains verified against their DNS, received emails, and svix-signed webhooks; keys and endpoints made on the dashboard.',
    adoption: { pypi: ['resend'], sdks: ['resend'], envStems: ['RESEND', 'NEXTPRIVATERESEND'] },
    hosts: [{ host: 'api.resend.com' }, { host: 'inbound-cdn.resend.com' }],
    // the World's applications hold a key the API Keys page made (the keys door), never a fixture: the twin refuses any
    // key it did not issue
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { RESEND_API_KEY: 'token' } },
  },
};
