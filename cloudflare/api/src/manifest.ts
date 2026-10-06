// Cloudflare API v4's manifest: the vendor facts its spec does not carry (architecture, "Protocol 3", in twin-world). The
// surface is generated (./generated/surface.gen.json) from Cloudflare's own OpenAPI document (../spec, api-schemas at
// d8c062a), grouped by its tags (../spec/grouping.json). What it serves is journeys/decisions.json; every other
// operation answers the gap, and those of its declared resources the core would answer are `unmodeled`.
import type { DerivedManifest } from '@volter/world-core';
import { data, values } from './semantics/events.ts';
import { states } from './semantics/states.ts';
import { uploadWithAssets } from './semantics/shared.ts';

export const manifest: DerivedManifest = {
  vendor: 'cloudflare',
  service: 'cloudflare',
  body: { json: 'always' },
  // Cloudflare's ids are 32 hex digits (a zone's, an account's, a token's); a few are UUIDs
  // source: spec:/components/schemas/iam_common_components-schemas-identifier "023e105f4ecef8ad9ca31a8372d0c353"
  ids: { template: '{hex:32}' },
  // spec *_api-response-single: `{ success: true, errors: [], messages: [], result }`
  // source: spec:/components/schemas/workers_api-response-common/properties/success "Whether the API call was successful"
  success: { success: true, errors: [], messages: [] },
  time: 'iso',
  // spec workers_api-response-common-failure: `{ success: false, errors: [{ code, message }], messages: [], result: null }`
  error: { success: false, errors: [{ code: '{code}', message: '{message}' }], messages: [], result: null },
  readOnly: { status: 403, code: '10000', message: 'This twin was started read-only; writes are refused.' },
  malformedBody: { status: 400, code: '10021', message: 'The request body is not JSON.' },
  // source: spec:/components/schemas/workers_api-response-common-failure "No route for the URI"
  notFound: { status: 404, code: '7003', message: 'No route for the URI' },
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "The World application's account and its token: an account its owner signed up for (the dashboard's sign-up, no API), its owner its Super Administrator, and an account token with R2, Workers, Turnstile and the account's zones' certificates. Every later account act is the API's or the dashboard's." },
    { id: 'dns', method: 'POST', path: '/_twin/dns', note: "{ name, type, value }: a record published at a DNS host outside Cloudflare (a registrar's nameservers for a zone, a SaaS customer's own domain), which Cloudflare's checks then see; never the zone's own DNS API." },
    { id: 'deliveries', method: 'GET', path: '/_twin/deliveries', note: '?to=<url>&type=<event>: every notification Cloudflare sent a webhook destination, in order, as its server got it' },
  ],
  screens: [
    { id: 'siteverify', kind: 'content', host: 'challenges.cloudflare.com', path: '/turnstile/v0/siteverify', status: 'done',
      demand: "Cal.com's sign-up and booking and Rallly's email OTP check a visitor's Turnstile token with the widget's secret.",
      source: 'https://developers.cloudflare.com/turnstile/get-started/server-side-validation/' },
    { id: 'turnstile-api', kind: 'content', host: 'challenges.cloudflare.com', path: '/turnstile/v0/api.js', status: 'done',
      demand: "Cal.com's, Rallly's and LibreChat's pages load the widget's script (react-turnstile, @marsidev/react-turnstile).",
      source: 'https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/' },
    { id: 'turnstile-challenge', kind: 'flow', host: 'challenges.cloudflare.com', path: '/turnstile/v0/challenge', status: 'done',
      demand: "The widget's frame a visitor passes on those pages, which hands the page its token.", controls: ['Verify you are human'],
      source: 'https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/' },
  ],
  // the operations of the declared resources the core would answer and no demand, the life or a published example
  // reaches: the gap
  // the account a root is: Cloudflare's API names it in its paths, and a token reaches the accounts it was made for
  // source: spec:accounts-list-accounts "List all accounts you have ownership or verified access to."
  account: 'iam_account',
  // an upload with assets is Cloudflare's direct-upload protocol at a deploy (./semantics/shared.ts)
  performs: { 'worker-script-upload-worker-module': uploadWithAssets, 'worker-versions-upload-version': uploadWithAssets },
  unmodeled: [
    'dns-records-for-a-zone-update-dns-record', 'dns-records-for-a-zone-patch-dns-record', 'dns-records-for-a-zone-review-dns-scan',
    'account-api-tokens-create-token',
    'account-api-tokens-delete-token',
    'account-api-tokens-token-details',
    'account-api-tokens-update-token',
    'account-creation',
    'account-deletion',
    'accounts-account-details',
    'accounts-turnstile-widget-delete',
    'accounts-turnstile-widget-update',
    'accounts-update-account',
    'custom-hostname-for-a-zone-custom-hostname-details',
    "user'-s-account-memberships-delete-membership",
    "user'-s-account-memberships-membership-details",
    "user'-s-account-memberships-update-membership",
    'notification-policies-delete-a-notification-policy',
    'notification-policies-get-a-notification-policy',
    'notification-webhooks-delete-a-webhook',
    'notification-webhooks-get-a-webhook',
    'user-api-tokens-create-token',
    'user-api-tokens-delete-token',
    'user-api-tokens-list-tokens',
    'user-api-tokens-token-details',
    'user-api-tokens-update-token',
    'user-edit-user',
    'user-memberships-get',
    'user-user-details',
    'worker-deployments-create-deployment',
    'worker-deployments-delete-deployment',
    'worker-deployments-get-deployment',
    'worker-subdomain-delete-subdomain',
    'worker-versions-upload-version',
    'zones-0-delete',
    'zones-0-get',
    'zones-0-patch',
  ],
  list: { style: 'envelope', envelope: { success: true, errors: [], messages: [], result: '{data}' }, limit: { param: 'per_page', default: 20, max: 50 } },
  // source: spec:dns-records-for-a-zone-delete-dns-record "Delete DNS Record"
  deleted: { result: { id: '{id}' }, success: true, errors: [], messages: [] },
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    // the asset upload reads its upload session's JWT from the same header (./semantics/worker-script.ts)
    exempt: ['worker-assets-upload'],
    // Cloudflare's answer to a request without a usable token: code 10000, "Authentication error"
    missing: { status: 401, code: '10000', message: 'Authentication error' },
    // a token the account holds (made on the dashboard's token pages, or the World's credential door), by its SHA-256
    held: { storedAs: 'api_token', hashField: '_sha256' },
    invalid: { status: 401, code: '10000', message: 'Authentication error' },
  },
  // Notifications (https://developers.cloudflare.com/notifications/): an alert an account's policy names, sent to each
  // webhook destination the policy names, the destination's secret in `cf-webhook-auth`. The SSL for SaaS Custom
  // Hostnames alert reports a custom hostname's certificate: the twin's certificate is validated, issued and deployed in
  // one write (the `dns` door's `hostname.certificate`), which sends each stage's event, and deleted with its hostname.
  // source: https://developers.cloudflare.com/notifications/get-started/configure-webhooks/ "Cloudflare will send your secret in the"
  // source: https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/ "All generic webhook notifications follow this schema:"
  events: {
    scheme: { kind: 'secret', header: 'cf-webhook-auth' },
    types: {
      'hostname.certificate': ['ssl.custom_hostname_certificate.validation.succeeded', 'ssl.custom_hostname_certificate.issuance.succeeded', 'ssl.custom_hostname_certificate.deployment.succeeded'],
      'custom_hostname.delete': 'ssl.custom_hostname_certificate.deletion.succeeded',
    },
    envelope: {
      name: '$endpoint.policy_name', text: '$text', data: '$data', ts: '$time.s', account_id: '$account', policy_id: '$endpoint.policy_id',
      policy_name: '$endpoint.policy_name', alert_type: 'custom_ssl_certificate_event_type', alert_correlation_id: '$id',
    },
    // each webhook a policy of the SSL for SaaS Custom Hostnames alert names, for its own account's hostnames
    endpoints: {
      storedAs: '_alert_route', joins: { webhook: { storedAs: 'alerting_webhook', by: 'webhook_id' } }, url: 'webhook.url', secret: 'webhook._secret', enabled: 'enabled',
      match: { alert_type: 'custom_ssl_certificate_event_type', account_id: '$account' },
    },
    record: '_notification_delivery',
    render: data,
    values,
  },
  resources: {
    // made by the dashboard's sign-up (the World's appCredentials door)
    iam_account: { storedAs: 'account', idPrefix: '', ...states['iam_account'], refresh: { list: 'accounts-list-accounts' } },
    zones_zone: { storedAs: 'zone', idPrefix: '', viewOmit: ['account_id'], filters: ['name'], ...states['zones_zone'], refresh: { list: 'zones-get' } },
    'tls-certificates-and-hostnames_custom-hostname': { storedAs: 'custom_hostname', idPrefix: '', ids: '{uuid}', parent: { param: 'zone_id', field: '_zone', resource: 'zones_zone' }, filters: ['hostname'],
      deleted: { id: '{id}' }, ...states['tls-certificates-and-hostnames_custom-hostname'], refresh: { list: 'custom-hostname-for-a-zone-list-custom-hostnames' } },
    // the root's credential, an account token, reads back the account's own tokens (a user's tokens are listed to the
    // user's token alone, at /user/tokens)
    iam_token_base: { storedAs: 'api_token', idPrefix: '', ...states['iam_token_base'], parent: { param: 'account_id', field: '_account', resource: 'iam_account' },
      refresh: { list: 'account-api-tokens-list-tokens', complete: false } },
    ApiToken: { storedAs: 'api_token', idPrefix: '', ...states.ApiToken, refresh: { none: "the same stored tokens as iam_token_base, read back by its list; a token's value is shown once and never read back" } },
    // a person's membership of an account (the dashboard's Members), and a person as the API names them
    // source: spec:user'-s-account-memberships-list-memberships "List memberships of accounts the user can access."
    'iam_membership-with-policies': { storedAs: 'account_member', idPrefix: '', ...states['iam_membership-with-policies'],
      refresh: { none: "a membership is read back by its person (GET /memberships, the user's own) with their user token; the root's credential is an account token, which acts as the account's service principal, no user" } },
    // source: https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/ "account API tokens allow you to set up durable integrations that can act as service principals"
    iam_single_user_response: { storedAs: 'cf_user', idPrefix: '', refresh: { none: "a person is read back by GET /user with their own user token; the root's credential is an account token, which acts as the account's service principal, no user" } },
    // a Worker, keyed `<account>/<name>`, and what its uploads make: a version and a deployment each, its secrets, its
    // Durable Object namespaces; the account's workers.dev subdomain
    // a script is listed by its name as `id`, its stored key `<account>/<name>` (./semantics/shared.ts scriptNameOf); a
    // version is listed short and read whole by its detail; the scripts', the secrets' and the Notifications' lists take
    // no page (their operations name none)
    worker_script: { idPrefix: '', key: '{account_id}/{id}', parent: { param: 'account_id', field: 'account_id', resource: 'iam_account' },
      refresh: { list: 'worker-script-list-workers', items: 'result', unpaginated: true,
        // source: spec:worker-cron-trigger-get-cron-triggers "Get the schedules (Cron Triggers) for a Worker script."
        detail: 'worker-cron-trigger-get-cron-triggers', detailMerge: 'result' } },
    'workers_version-item-full': { storedAs: 'worker_version', idPrefix: '', ids: '{uuid}',
      parent: { params: ['account_id', 'script_name'], value: '{account_id}/{script_name}', field: 'script', resource: 'worker_script', where: { account_id: '{account_id}', id: '{script_name}' } },
      refresh: { list: 'worker-versions-list-versions', items: 'result.items', detail: 'worker-versions-get-version-detail' } },
    workers_deployment: { storedAs: 'worker_deployment', idPrefix: '', ids: '{uuid}',
      parent: { params: ['account_id', 'script_name'], value: '{account_id}/{script_name}', field: 'script', resource: 'worker_script', where: { account_id: '{account_id}', id: '{script_name}' } },
      refresh: { list: 'worker-deployments-list-deployments', items: 'result.deployments' } },
    worker_secret: { idPrefix: '', key: '{account_id}/{script_name}::{name}',
      parent: { params: ['account_id', 'script_name'], value: '{account_id}/{script_name}', field: '_script', resource: 'worker_script', where: { account_id: '{account_id}', id: '{script_name}' } },
      refresh: { list: 'worker-list-script-secrets', unpaginated: true } },
    durable_object_namespace: { idPrefix: '', parent: { param: 'account_id', field: 'account_id', resource: 'iam_account' }, refresh: { list: 'durable-objects-namespace-list-namespaces' } },
    // the account's one workers.dev subdomain, kept by the account's id: read again for each account the vendor holds
    'workers_subdomain-2': { storedAs: 'workers_subdomain', idPrefix: '', key: '{account_id}', parent: { param: 'account_id', field: 'account_id', resource: 'iam_account' }, refresh: { get: 'worker-subdomain-get-subdomain' } },
    _assets_session: { idPrefix: '' },
    // a Worker's Custom Domain: a hostname in one of the account's zones the Worker answers (./semantics/domains.ts)
    workers_Domain: { storedAs: 'worker_domain', idPrefix: '', refresh: { none: 'a Custom Domain is read back under its Worker by the Domains list, which this pack does not refresh yet' } },
    // a record its customer published at a DNS host outside Cloudflare (the `dns` door)
    _external_dns: { idPrefix: '' },
    // A zone's DNS records: retain the original parent in state while the vendor's response omits it.
    'dns-records_dns-record-response': { storedAs: 'dns_record', idPrefix: '', parent: { param: 'zone_id', field: 'zone_id', resource: 'zones_zone' }, viewOmit: ['zone_id'], filters: ['name', 'type'], refresh: { list: 'dns-records-for-a-zone-list-dns-records' } },
    // a Turnstile widget, its sitekey its id, and a token a visitor earned from it (the challenge screen). Its detail
    // answers the widget's secret, so a vendor-backed refresh reads the widgets by their secret-free listing alone and never
    // their detail: a live secret belongs to credential custody, never the tree (architecture, refresh). Two declarations
    // over the one stored type, because each holds what the other cannot: the derived core serves the spec's widget read,
    // update, delete and secret rotation by the declaration named as their resource, turnstile_widget_detail (an operation
    // whose resource has no declaration is unmodeled: world-core derived-core's "no manifest entry for resource"), and
    // derive refuses a list scope there with no detail read (the list reads turnstile_widget_list), so the listing's
    // declaration carries it. A third name the spec does not define would still leave turnstile_widget_detail declared.
    // source: spec:/components/schemas/turnstile_secret "Secret key for this widget."
    turnstile_widget_detail: { storedAs: 'turnstile_widget', idPrefix: '0x4AAAAAAA', ids: '{prefix}{letters:14}', idAs: 'sitekey', ...states.turnstile_widget_detail,
      parent: { param: 'account_id', field: '_account', resource: 'iam_account' }, refresh: { none: 'the same stored widgets are read by turnstile_widget_list; their live secrets are not refreshed from detail' } },
    // source: spec:accounts-turnstile-widgets-list "Lists Turnstile widgets for an account."
    turnstile_widget_list: { storedAs: 'turnstile_widget', idPrefix: '0x4AAAAAAA', idAs: 'sitekey', ...states.turnstile_widget_list,
      parent: { param: 'account_id', field: '_account', resource: 'iam_account' },
      refresh: { list: 'accounts-turnstile-widgets-list', items: 'result' } },
    _turnstile_token: { idPrefix: '' },
    // R2's buckets, their public domains and temporary credentials, shared with the S3 lane (its Bucket, CustomDomain)
    // buckets are listed a jurisdiction at a time (its header), the next page by the answer's cursor; a bucket's custom
    // domains under it, in its jurisdiction, keyed by the bucket's stored id and the domain
    // source: spec:r2-list-buckets "Lists a page of R2 buckets in the account and selected jurisdiction."
    // source: spec:/components/schemas/r2_jurisdiction "Jurisdiction where objects in this bucket are guaranteed to be stored."
    Bucket: { storedAs: 'r2_bucket', idPrefix: '', key: '{account_id}:{name}', parent: { param: 'account_id', field: 'account_id', resource: 'iam_account' },
      refresh: { list: 'r2-list-buckets', items: 'result.buckets', next: 'result_info.cursor', cursor: 'cursor',
        variants: [{ headers: { 'cf-r2-jurisdiction': 'default' } }, { headers: { 'cf-r2-jurisdiction': 'eu' } }, { headers: { 'cf-r2-jurisdiction': 'us' } },
          { headers: { 'cf-r2-jurisdiction': 'fedramp' } }, { headers: { 'cf-r2-jurisdiction': 'fedramp-high' } }] } },
    CustomDomain: { storedAs: 'r2_custom_domain', idPrefix: '', ...states.CustomDomain, key: '{_bucket}:{domain}',
      parent: { params: ['account_id', 'bucket_name'], value: '{account_id}:{bucket_name}', field: '_bucket', resource: 'Bucket', where: { account_id: '{account_id}', name: '{bucket_name}', jurisdiction: '{jurisdiction}' } },
      refresh: { list: 'r2-list-custom-domains', items: 'result.domains', unpaginated: true, headers: { 'cf-r2-jurisdiction': '{jurisdiction}' } } },
    // Notifications: an account's webhook destinations and its policies, and each policy's route to a destination
    aaa_webhooks: { storedAs: 'alerting_webhook', idPrefix: '', ...states.aaa_webhooks, parent: { param: 'account_id', field: 'account_id', resource: 'iam_account' }, refresh: { list: 'notification-webhooks-list-webhooks', unpaginated: true } },
    aaa_policies: { storedAs: 'alerting_policy', idPrefix: '', ...states.aaa_policies, parent: { param: 'account_id', field: 'account_id', resource: 'iam_account' }, refresh: { list: 'notification-policies-list-notification-policies', unpaginated: true } },
    _alert_route: { idPrefix: '' },
    _notification_delivery: { idPrefix: '' },
    TemporaryCredential: { storedAs: 'r2_temporary_credential', idPrefix: '', refresh: { none: 'R2 lists no temporary credentials: each is answered once, at its creation, and expires' } },
  },
};
