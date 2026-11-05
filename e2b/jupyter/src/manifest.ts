// Each sandbox's code-interpreter door (spec/SOURCE.md), at `49999-<sandboxID>.e2b.app`.
// The sandbox is named in the host (`hostParams`).
// It shares the vendor's store with the api lane.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'e2b',
  unmodeled: [],
  service: 'e2b',
  body: {},
  ids: { template: '{uuid}' },
  time: 'iso',
  // Connect's error body (https://connectrpc.com/docs/protocol, "Error"): `{code, message}`
  error: { code: '{code}', message: '{message}' },
  readOnly: { status: 403, code: 'permission_denied', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'not found' },
  gap: { status: 404, code: 'unimplemented', message: 'the method is not implemented by this twin' },
  hostParams: '^(?<port>\\d+)-(?<sandboxID>[a-z0-9]+)\\.',
  remoteHost: { template: '49999-{sandboxID}.e2b.app' },
  deleted: {},
  resources: {},
  vendorBacked: { none: 'The sandbox service is a compute wire; lifecycle operations and refresh belong to the api lane.' },
  discovery: {
    twinOf: "a sandbox's code interpreter: execution in its template image, with newline-delimited results",
    stores: 'nothing of its own: the sandbox and its machine belong to the api lane',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-e2b-jupyter',
    resources: [],
    specSource: "the official code-interpreter SDK and template server (spec/SOURCE.md)",
    description: "E2B's code interpreter — persistent code execution.",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ suffix: '.e2b.app' }],
    endpointEnvNone: 'the vendor lane',
  },
};
