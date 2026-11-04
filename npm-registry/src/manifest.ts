// The npm registry's manifest: the vendor facts its client-derived spec does not carry (docs/contributing/architecture.md,
// "Protocol 3", in twin-world). The surface is generated (./generated/surface.gen.json) from npm 10.9.8's own registry
// calls (../spec/client-ops.json).
//
// EVERY SERVED OPERATION IS A HANDLER (./semantics/index.ts). The registry is CouchDB-shaped: a package is one document
// that a publish rewrites, its versions and bytes beside it; the client names none of that as create, read, update or
// delete. So the core owns nothing. What is served is what the applications call (../journeys/demand.json): install's
// document and tarball reads, one version by its number or tag, a version's attestations, dist-tag ls, search and
// publish; the rest is `unmodeled`.
//
// A package is held in its vendor document shape, versions embedded; bytes are resource blobs.
// User and organization accounts are World page setup, and tokens are private bookkeeping.
//
// WHY NO MANIFEST `auth`. The registry reads `Bearer` and `Basic` credentials, answers anonymous reads, and decides
// permission by the package's scope and maintainers (./semantics/shared.ts `caller`, `mayWrite`).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';


export const manifest: DerivedManifest = {
  vendor: 'npm-registry',
  service: 'npm-registry',
  body: { json: 'always' },
  // source: recording:registry-cors.txt "access-control-allow-origin: *"
  cors: { origin: '*', methods: 'GET, HEAD', headers: 'accept' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // the registry's Error object (npm/registry docs/user/authentication.md, "Error": `{ message, error, ok }`, clients
  // check `message` then `error`); its not-found answer is `{ "error": "Not found" }`
  error: { error: '{message}' },
  defaultKind: 'registry',
  readOnly: { status: 403, message: 'This registry was started read-only; writes are refused.' },
  malformedBody: { status: 400, message: 'Invalid JSON' },
  notFound: { status: 404, message: 'Not found' },
  // required by the type; the handlers page their own lists (search's `from`/`size`, tokens' `page`/`perPage`)
  list: { style: 'envelope', envelope: { objects: '{data}' }, limit: { param: 'size', default: 20, max: 250 } },
  deleted: {},
  // `dist.tarball` is minted at the registry's own origin, rewritten to where this twin is reached
  origin: { placeholder: 'https://registry.npmjs.org' },
  // the fail-closed ceiling on live calls against the registry (world-core rateBudget.ts, architecture D8). Where the
  // documentation stops: npm publishes no per-minute allowance for its public registry (its terms admit the APIs it
  // documents), so the window holds a loop to the platform's fallback, 30 calls a minute.
  // source: https://docs.npmjs.com/policies/open-source-terms "You may search for, download, publish, and manage Packages using software other than CLI via application programming interfaces that npm publicly documents or makes available for public use"
  rateBudget: {
    reason: 'npm publishes no per-minute allowance for registry.npmjs.org (https://docs.npmjs.com/policies/open-source-terms admits the APIs it documents and states no limit); with none documented the window holds a loop to the platform\'s fallback, 30 calls a minute.',
    windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60,
  },
  // the World's doors (./semantics/doors.ts): what npmjs.com's pages do that the registry's API does not
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the publish token an application holds (a World user's), as the runtime issues it" },
    { id: 'users', method: 'POST', path: '/_twin/users', note: "a user (npmjs.com's sign-up page), with a publish token for it" },
    { id: 'orgs', method: 'POST', path: '/_twin/orgs', note: "an organization (npmjs.com's \"create an organization\" page), its owner a user the World holds" },
  ],
  // GET /twin: what the twin is of, what it keeps, and how it is authenticated
  discovery: {
    twinOf: 'the npm registry (registry.npmjs.org): install, one version by number or tag, provenance attestations, dist-tags, search and publish',
    stores: 'package documents with embedded versions and tarball blobs, users, orgs and tokens (by their sha512, never as issued)',
    identity: 'Send `Authorization: Bearer <token>` (a token from POST /_twin/users or POST /_twin/app-credentials) or Basic credentials; anonymous requests read public packages.',
  },
  resources: {
    // source: https://raw.githubusercontent.com/npm/registry/main/docs/responses/package-metadata.md "the package name, used as an ID in CouchDB"
    package: { idPrefix: '', idAs: 'name', key: '{name}', ...states.package, refresh: { get: 'pacote.packument', known: true, blobs: [{ path: 'versions.*.dist.tarball', key: 'tarball{pathname}' }, { path: 'versions.*.dist.attestations.url', key: 'attestation{pathname}' }] } },
    user: { idPrefix: '', unique: [{ fields: ['name'], refusal: { status: 400, message: 'the user exists' } }], ...states.user, refresh: { none: 'Users are account setup through npmjs.com; no user enumeration or profile read is served by the demanded registry surface.' } },
    org: { idPrefix: '', ...states.org, refresh: { none: 'Organizations are account setup through npmjs.com; no organization read is served by the demanded registry surface.' } },
    _serial: { idPrefix: '', ids: '{n}' },
  },
  unmodeled: [
    // called by no application here (../journeys/demand.json)
    'stars.exec', 'libnpmhook.stream', 'libnpmhook.add', 'libnpmhook.rm', 'libnpmhook.find', 'libnpmhook.update',
    'verify-signatures.setKeys', 'arborist.getReport', 'arborist.getReport_2', 'npm-profile.paginate',
    'npm-profile.createToken', 'npm-profile.removeToken', 'npm-profile.get', 'npm-profile.set', 'libnpmorg.rm',
    'libnpmorg.stream', 'libnpmorg.set', 'libnpmaccess.getPackages', 'libnpmteam.stream', 'libnpmteam.create',
    'libnpmaccess.setAccess', 'libnpmaccess.getCollaborators', 'dist-tag.add', 'dist-tag.remove',
    'libnpmaccess.getVisibility', 'ping.call', 'libnpmteam.destroy', 'libnpmaccess.removePermissions',
    'libnpmaccess.setPermissions', 'libnpmteam.rm', 'libnpmteam.stream_2', 'libnpmteam.add',
    'libnpmaccess.getPackages_2', 'npm-profile.loginCouch', 'npm-profile.putCouch', 'logout.exec',
    'npm-profile.webAuthCheckLogin', 'npm-profile.webAuth', 'get-identity.call', 'libnpmpublish.unpublish',
    'libnpmpublish.unpublish_2', 'libnpmpublish.unpublish_3'],
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-npm-registry',
    resources: ['package', 'user', 'org'],
    specSource: 'the registry calls npm 10.9.8 makes (spec/client-ops.json, provenance in spec/SOURCE.md), and npm/registry\'s docs',
    description: 'npm registry twin — install (full and abbreviated documents, tarballs with sha1 and sha512), one version by number or tag, publish (with provenance checked) and its attestations, dist-tag ls and search with its qualifiers.',
    adoption: {
      // no `sdks`: the registry's clients are the npm and bun executables, which read their registry from .npmrc
      envStems: ['NPM'],
      tools: [{ package: 'npm', usage: 'build' }],
    },
    hosts: [{ host: 'registry.npmjs.org' }],
    credentialDoor: { account: { field: 'account', tenancy: 'user account', source: 'https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md' }, deployment: { field: 'deployment', object: 'user access token', source: 'https://docs.npmjs.com/about-access-tokens' }, path: '/_twin/app-credentials', body: {}, fill: { NODE_AUTH_TOKEN: 'token', NPM_TOKEN: 'token' } },
    endpointEnv: { name: 'NPM_CONFIG_REGISTRY', note: 'npm and bun read the registry from npm_config_registry (and .npmrc\'s `registry`).' },
  },
};
