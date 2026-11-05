// The tunnel relay's manifest (volter-ai/volter-tunnel, spec/SOURCE.md): a protocol more than an API. A client holds
// the control socket (`control`, semantics/sockets.ts) and answers the public requests the relay sends down it
// (semantics/around.ts). Served is what Volter Harness's remote access uses (../journeys/demand.json).
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'tunnel',
  service: 'tunnel',
  body: { json: 'always' },
  unmodeled: ['getStatus'],
  vendorBacked: { none: 'The served wire forwards HTTP over a live control socket; account and reservation rows are World bookkeeping, with no served vendor resource API to perform or refresh.' },
  // source: spec:/x-reference/relay "crypto.randomUUID().slice(0, 8)"
  ids: { template: '{letters:8}' },
  time: 'iso',
  error: '{message}',
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  // The unserved HTTP operations use the pack gap; the served socket refuses in protocol frames.
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  resources: {
    _account: { idPrefix: '', unique: [{ fields: ['slug'], refusal: { status: 409, message: 'Account slug already exists' } }] },
    // a tunnel id an account holds (one minted when a client names none)
    _tunnel: { idPrefix: '' },
  },
  // source: spec:/x-reference/protocol "for the messages exchanged over the control WebSocket between a client and the"
  sockets: [
    { id: 'control', path: '/ws', note: "a client's control channel: register, then answer each request the relay sends", source: 'https://github.com/volter-ai/volter-tunnel/blob/main/packages/core/src/protocol.ts' },
  ],
  doors: [
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: '{}: the default World account; { account, deployment? }: a retained World account; { slug }: an account on the relay and its token (the World application\'s TUNNEL_SECRET)' },
  ],
  discovery: {
    twinOf: "Volter's tunnel relay (volter-tunnel) as Volter Harness's remote access uses it: a client's control socket, and every request to its tunnel answered through it",
    stores: 'accounts and their tokens (by their SHA-256), and the tunnel ids they hold',
    identity: "the account's token in the control channel's register frame",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'proxy',
    bin: 'world-tunnel',
    resources: [],
    specSource: 'written from volter-ai/volter-tunnel (spec/SOURCE.md)',
    description: "Tunnel relay twin — a client's control socket (register, then each public request sent down it and answered by the frames it sends back), as Volter Harness's remote access shares a local server.",
    // source: spec:/x-reference/protocol "Shared secret or api/login token authenticating the client."
    adoption: { sdks: ['@volter/tunnel'], envStems: ['TUNNEL', 'VOLTERTUNNEL'] },
    // source: spec:/x-reference/domain "voltertest.xyz"
    hosts: [{ host: 'voltertest.xyz' }, { suffix: '.voltertest.xyz' }, { host: 'www.voltertest.xyz', exclude: true }, { host: 'twins.voltertest.xyz', exclude: true }],
    credentialDoor: { account: { field: 'account', tenancy: 'Relay account', source: 'https://github.com/volter-ai/volter-tunnel/tree/c14b6e36722b20cbb3ee7245c7f555b5c12b376e' }, deployment: { field: 'deployment', object: 'Customer account token', source: 'https://github.com/volter-ai/volter-tunnel/tree/c14b6e36722b20cbb3ee7245c7f555b5c12b376e', organizationOutputs: ['TUNNEL_SECRET', 'TUNNEL_SERVER_URL', 'SUPERCODE_TUNNEL_SERVER_URL'] },  path: '/_twin/accounts', body: {}, fill: { TUNNEL_SECRET: 'token', TUNNEL_SERVER_URL: 'server', SUPERCODE_TUNNEL_SERVER_URL: 'server' } },
    endpointEnvNone: 'the relay URL is the credential door\'s (TUNNEL_SERVER_URL, SUPERCODE_TUNNEL_SERVER_URL), the World claiming voltertest.xyz',
  },
};
