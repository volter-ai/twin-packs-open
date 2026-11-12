// Rekor's manifest: the vendor facts its spec does not carry (architecture, "Protocol 3"). The surface is generated
// (./generated/surface.gen.json, from ../spec by derive-pack).
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'sigstore',
  service: 'sigstore-rekor',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // source: spec:/definitions/Error "message"
  error: { code: '{code}', message: '{message}' },
  readOnly: { status: 403, code: '403', message: 'This twin was started read-only; entries are not logged.' },
  notFound: { status: 404, code: '404', message: 'entry not found' },
  // a path Rekor does not have, as its server answers it
  gap: { status: 404, code: '404', message: 'path not found' },
  // every operation is a handler's; the core pages nothing
  deleted: {},
  resources: {},
  // called by no application here (../../journeys/demand.json): npm publish --provenance asks Fulcio for a certificate
  // and Rekor for an entry, and the npm registry reads Fulcio's trust bundle and Rekor's verification key
  unmodeled: ['searchIndex', 'getLogInfo', 'getLogEntryByIndex', 'getLogEntryByUUID', 'searchLogQuery', 'getLogProof'],
};
