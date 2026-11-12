// Sigstore's manifest: the services `npm publish --provenance` signs through, each a lane of its own OpenAPI description
// (architecture, "Other wires: lanes"): Fulcio at fulcio.sigstore.dev certifies a key for an OIDC identity, and Rekor at
// rekor.sigstore.dev logs the signed statement. A request sent to the twin directly goes by its path: Fulcio's API is
// /api/v2/, Rekor's everything else.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'sigstore',
  discovery: {
    twinOf: 'Sigstore: Fulcio, the certificate authority that certifies a key for an OIDC identity (a GitHub Actions workflow), and Rekor, the transparency log of signed statements',
    stores: "the certificates Fulcio issued and the log's entries",
  },
  lanes: {
    routes: [
      { lane: 'fulcio', host: '^fulcio\\.sigstore\\.dev$' },
      { lane: 'rekor', host: '^rekor\\.sigstore\\.dev$' },
      { lane: 'fulcio', path: '/api/v2' },
    ],
    default: 'rekor',
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-sigstore',
    resources: [],
    specSource: "Fulcio's and Rekor's own OpenAPI descriptions (fulcio/spec, rekor/spec; provenance in each SOURCE.md)",
    description: 'Sigstore twin — Fulcio certifies a key for a GitHub Actions identity (its token checked against the World\'s GitHub), and Rekor logs the signed statement with its signed timestamp and inclusion proof: what npm publish --provenance signs through.',
    adoption: { sdks: ['sigstore', '@sigstore/sign'], envStems: ['SIGSTORE'] },
    hosts: [{ host: 'fulcio.sigstore.dev' }, { host: 'rekor.sigstore.dev' }],
    endpointEnvNone: 'npm and the sigstore library read no address for Fulcio or Rekor: both are fixed hosts, claimed by the host rules.',
  },
};
