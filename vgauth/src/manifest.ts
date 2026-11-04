import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'vgauth', service: 'vgauth', body: {}, spanning: ['path'],
  ids: { template: '{uuid}' }, time: 'unix-ms',
  // source: recording:worker-source.txt "headers.set('X-Content-Type-Options', 'nosniff');"
  answerHeaders: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Content-Type-Options': 'nosniff' },
  // source: recording:worker-source.txt "return json({ error: 'Not found' }, 404, request, env);"
  error: { error: '{message}' }, gap: { status: 404, message: 'Not found' },
  notFound: { status: 404, message: 'Not found' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } }, deleted: {},
  resources: { Account: { ...states.Account, storedAs: 'account', idPrefix: '', refresh: { get: 'accountProjection', known: true } }, _settings: { idPrefix: '' }, _nonce: { idPrefix: '' }, _handoff: { idPrefix: '' }, _invitation_usage: { idPrefix: '', unique: [{ fields: ['host'], refusal: { status: 409, message: 'Invitation quota exists.' } }] } },
  unmodeled: ['internalAccountIdentity', 'verify', 'relayToken', 'relayGrant', 'relaySession'],
  // source: recording:worker-source.txt "Identity is delegated wholly to Clerk; authorization is a signed token."
  vendorBacked: { none: 'The served account snapshot is read through accountProjection under its bearer identity; its resource declares that refresh. Identity belongs to Clerk. Invitation quotas and opaque handoffs are private bookkeeping with no vendor read-back API.' },
  discovery: {
    twinOf: 'Volter’s vgai-auth Cloudflare Worker at auth.videogame.ai: the native account PKCE broker, Clerk proxy, account projection, collaboration handoffs and the editor’s source-defined refusals.',
    behavior: 'The life and Editor recipe serve the source-shipped non-production Free/100 catalog (scripts/run-managed-services-dev.ts:71-73) on the service-bound account path; these are not production catalog values or its allowance.',
    stores: 'operator settings, first-read managed account snapshots, opaque handoffs, nonce occurrences and invitation quotas; Clerk owns identities and sessions',
    identity: 'A Clerk session JWT, verified through the World’s Clerk JWKS. POST /_twin/configuration sets the Worker’s provider and binding configuration; the deployed public client is vgai-editor.',
  },
  // source: recording:worker-source.txt "CLERK_API_URL?: string;"
  // source: recording:worker-source.txt "VGAI_ACCOUNT_CLIENT_ID?: string;"
  doors: [{ id: 'configuration', method: 'POST', path: '/_twin/configuration', note: 'Worker provider settings: Clerk keys/API, callback and OAuth URLs; freePlan supplies an explicit deployment catalog entry (name and includedCredits); the life and Editor recipe use the source-shipped non-production Free/100 catalog, not production values; billingBound=false selects the separate no-binding branch. Client id stays vgai-editor; accounts are created by the first authenticated read, not this door.' }],
  // The vendor defines no global request allowance. The standard conservative fallback applies.
  rateBudget: { reason: 'No service-wide allowance in the pinned Worker source; conservative fallback.', windowMs: 60000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60 },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'proxy', bin: 'world-vgauth', resources: ['Account'],
    specSource: 'spec/openapi.json, written from volter-ai/vgai-engine 8623e308 packages/vgai-auth/src/worker.ts (spec/SOURCE.md)',
    description: 'Volter managed account OAuth broker and collaboration authority at auth.videogame.ai, with Clerk as its upstream identity provider.',
    adoption: { sdks: [], envStems: [] },
    // source: recording:deployment-source.txt "custom_domain = true"
    hosts: [{ host: 'auth.videogame.ai' }],
    // The editor derives its OAuth issuer and auth URL from this account URL; discovery returns the vendor origin.
    endpointEnv: { name: 'VOLTER_ACCOUNT_URL', templates: { VOLTER_ACCOUNT_URL: '${url}' }, note: 'Volter Editor managed-account-defaults.ts derives VOLTER_OAUTH_ISSUER_URL and VOLTER_AUTH_URL from this URL.' },
    credentialDoor: { path: '/_twin/configuration', body: {}, account: { field: 'account', tenancy: 'none (one Worker, fixed client vgai-editor)', source: 'https://github.com/volter-ai/vgai-engine/tree/archive/launch-scope-2026-09-20/packages/vgai-auth' }, deployment: { field: 'deployment', object: 'none', source: 'https://github.com/volter-ai/vgai-engine/tree/archive/launch-scope-2026-09-20/packages/vgai-auth' }, fill: {} },
  },
};
