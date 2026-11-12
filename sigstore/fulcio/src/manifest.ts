// Fulcio's manifest: the vendor facts its spec does not carry (architecture, "Protocol 3"). The surface is generated
// (./generated/surface.gen.json, from ../spec by derive-pack).
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'sigstore',
  service: 'sigstore-fulcio',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // gRPC's status, as the gateway answers every refusal
  // source: spec:/definitions/rpcStatus "code"
  error: { code: '{code}', message: '{message}', details: [] },
  readOnly: { status: 403, code: '7', message: 'This twin was started read-only; certificates are not issued.' },
  notFound: { status: 404, code: '5', message: 'Not Found' },
  // every operation is a handler's; the core pages nothing
  deleted: {},
  resources: {},
  // called by no application here (../../journeys/demand.json): npm publish --provenance asks Fulcio for a certificate
  // and Rekor for an entry, and the npm registry reads Fulcio's trust bundle
  unmodeled: ['CA_GetConfiguration'],
};
