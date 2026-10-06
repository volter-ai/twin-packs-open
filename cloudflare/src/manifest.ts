// Cloudflare, a vendor of lanes: its API v4 (api.cloudflare.com/client/v4, the dashboard's token pages on
// dash.cloudflare.com and Turnstile on challenges.cloudflare.com: the `api` lane's screens and the `r2` lane's) and R2
// over S3's API (<account>.r2.cloudflarestorage.com, the `r2` lane), over one vendor state.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'cloudflare',
  discovery: { twinOf: 'Cloudflare API v4 (token verify, wrangler deploy and secrets, R2 control plane, Cloudflare for SaaS custom hostnames, Turnstile widgets and siteverify) and R2 S3 storage', stores: 'accounts, people and their scoped API tokens, Workers modules, versions, deployments and secrets, zones and custom hostnames, Turnstile widgets and tokens, shared R2 buckets, object bytes, multipart uploads and public domains' },
  lanes: { routes: [{ lane: 'api', host: '^api\\.cloudflare\\.com$' }, { lane: 'api', host: '^challenges\\.cloudflare\\.com$' }, { lane: 'api', path: '/client/v4' }], default: 'r2' },
  // The API's documented allowance, which R2's REST API shares; R2's S3 API documents no request allowance of its own
  // (per-bucket management at 50 a second), so its calls are charged on the same ledger. The kernel caps a window's
  // ceiling at 1,000, under the documented 1,200; the minute's burst is the five-minute allowance spread evenly.
  // source: https://developers.cloudflare.com/fundamentals/api/reference/limits/ "The global rate limit for the Cloudflare API is 1,200 requests per five minute period per user"
  // source: https://developers.cloudflare.com/fundamentals/api/reference/limits/ "If you exceed this limit, all API calls for the next five minutes will be blocked"
  // source: https://developers.cloudflare.com/r2/platform/limits/ "rate limited to 1,200 requests per five minutes across all R2 REST API operations on your account"
  rateBudget: {
    // the vendor's documented allowance, a minute's share of its five-minute 1,200 (cited above)
    allowance: { perMinute: 240, source: 'https://developers.cloudflare.com/fundamentals/api/reference/limits/' },
    reason: "Cloudflare's API allows 1,200 requests per five minutes per user and blocks every call for the next five minutes past it (https://developers.cloudflare.com/fundamentals/api/reference/limits/); R2's REST API is held to the same 1,200 per five minutes (https://developers.cloudflare.com/r2/platform/limits/). The window is five minutes at the kernel's ceiling of 1,000 (under 1,200), with a minute's burst of 240 (1,200 spread over five minutes); a Retry-After past five minutes is the credential in trouble.",
    windowMs: 300_000, ceiling: 1_000, burstCeiling: 240, defaultWeight: 1, maxRetryAfterSeconds: 300,
  },
  // a vendor-backed World's root: the account's Notifications sent to the World's ingest door, the destination's secret
  // in `cf-webhook-auth`; an SSL for SaaS event names its type at `data.metadata.event.type`, its hostname at `data.data`
  // and the hostname's zone at `data.metadata.zone.id`
  // source: https://developers.cloudflare.com/notifications/get-started/configure-webhooks/ "If this header is not present, or is not your specified value, you should reject the webhook."
  // source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/webhook-definitions/ "Cloudflare sends this alert when certificates move from a status of"
  ingest: {
    scheme: { kind: 'secret', header: 'cf-webhook-auth' },
    type: { body: 'data.metadata.event.type' },
    object: 'data.data',
    types: {
      'ssl.custom_hostname_certificate.validation.succeeded': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.validation.failed': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.issuance.succeeded': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.issuance.failed': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.deployment.succeeded': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.deployment.failed': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.renewal.succeeded': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.renewal.failed': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
      'ssl.custom_hostname_certificate.deletion.succeeded': { resource: 'tls-certificates-and-hostnames_custom-hostname', parent: 'data.metadata.zone.id' },
    },
  },
  descriptor: {
    // a vendor-backed World's root: the API takes the account's token as a bearer, R2's S3 API a SigV4 signature under an
    // R2 key, region auto (architecture, "Lanes"); one root credential holds both
    // source: https://developers.cloudflare.com/r2/api/s3/api/ "the region for an R2 bucket is auto"
    auth: { in: 'lanes', lanes: { r2: { in: 'signature', algorithm: 'aws-sigv4', scope: { region: 'auto', service: 's3' } } } },
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-cloudflare',
    resources: ['account', 'api_token', 'worker_script', 'worker_version', 'worker_deployment', 'worker_secret', 'zone', 'custom_hostname', 'turnstile_widget', 'r2_bucket', 'r2_object', 'r2_multipart', 'r2_custom_domain'],
    specSource: 'Cloudflare api-schemas d8c062a and AWS S3 Smithy 9b1a492, R2 compatibility corrections; see each lane spec/SOURCE.md',
    description: "Cloudflare's API token verify and dashboard token pages, wrangler deploy and secrets, R2 buckets, temporary credentials and public custom domains, Cloudflare for SaaS custom hostnames, Turnstile widgets, their challenge and siteverify; R2's S3 storage with presigned URLs, CORS, lifecycle and multipart uploads.",
    adoption: { pypi: ['cloudflare'], sdks: ['cloudflare', 'aws4fetch', 'react-turnstile', '@marsidev/react-turnstile'], envStems: ['CLOUDFLARE', 'TURNSTILE'], tools: [{ package: 'wrangler', usage: 'deployment' }] },
    hosts: [{ host: 'api.cloudflare.com' }, { host: 'dash.cloudflare.com', pathPattern: '^/($|login|profile/api-tokens|_twin/users/|[0-9a-f]{32}/(r2/api-tokens|workers-and-pages))' },
      { host: 'challenges.cloudflare.com', pathPattern: '^/turnstile/v0/' }, { suffix: '.r2.cloudflarestorage.com' }],
    hostsClaimed: { door: '/_twin/hosts', note: 'R2 custom domains registered to a bucket (public read still requires enabled and active ownership/TLS), and Workers Custom Domains, answered with the Worker static assets.' },
    credentialDoor: { path: '/_twin/app-credentials', body: { account: 'world' }, fill: { CLOUDFLARE_API_TOKEN: 'api_token', CLOUDFLARE_API_KEY: 'api_token', CLOUDFLARE_ACCOUNT_ID: 'account_id', R2_ACCESS_KEY_ID: 'r2_access_key_id', R2_SECRET_ACCESS_KEY: 'r2_secret_access_key', CLOUDFLARE_ACCESS_KEY: 'r2_access_key_id', CLOUDFLARE_SECRET_ACCESS_KEY: 'r2_secret_access_key', R2_ENDPOINT: 'r2_endpoint' } },
    endpointEnv: { name: 'CLOUDFLARE_API_BASE_URL', templates: { CLOUDFLARE_API_BASE_URL: '${url}/client/v4' }, note: 'Cloudflare SDK and wrangler API base.' },
  },
};
