// Google Web Risk's Protocol 3 manifest. journeys/demand.json records no Web Risk caller.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'webrisk',
  service: 'webrisk',
  body: { json: 'always' },
  ids: { template: '{hex:16}' },
  time: 'iso',
  // source: https://google.aip.dev/193 "The following JSON shows a fully populated HTTP/1.1+JSON representation of an error response."
  error: { error: { code: '{status}', message: '{message}', status: '{kind}' } },
  defaultKind: 'INVALID_ARGUMENT',
  readOnly: { status: 403, kind: 'PERMISSION_DENIED', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, kind: 'NOT_FOUND', message: 'Not found' },
  // No operation is in scope. The kernel maps this canonical error to gRPC status 12.
  // source: https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/rpc/code.proto "HTTP Mapping: 501 Not Implemented"
  gap: { status: 501, kind: 'UNIMPLEMENTED', message: 'The method is not implemented by this twin.' },
  grpc: true,
  deleted: {},
  resources: {},
  unmodeled: [
    'ComputeThreatListDiff', 'SearchUris', 'SearchHashes', 'CreateSubmission', 'SubmitUri',
    'ListOperations', 'GetOperation', 'DeleteOperation', 'CancelOperation', 'WaitOperation',
  ],
  // This is a scope fact, not a claim that Web Risk has no stored submissions.
  vendorBacked: { none: 'No operation is in scope and no vendor resource, event or mutation is modeled; the pack only answers the gap.' },
  // source: https://cloud.google.com/web-risk/docs/lookup-api "The Lookup API lets your client applications check if a URL is included on any"
  discovery: {
    twinOf: 'Google Web Risk v1: the vendored gRPC surface, with no operation in the measured demand',
    stores: 'No stored resources or credentials',
    identity: 'No served operation accepts a credential',
  },
  descriptor: {
    protocol: '3',
    transport: 'raw-tcp',
    archetype: 'crud',
    bin: 'world-webrisk',
    resources: [],
    specSource: "Google's Web Risk v1 proto files (spec/SOURCE.md)",
    description: 'Google Web Risk v1 gRPC surface; operations outside the measured demand answer UNIMPLEMENTED.',
    // Generic Google credential/project variables identify no Web Risk caller.
    adoption: { sdks: ['@google-cloud/web-risk'] },
    // source: https://raw.githubusercontent.com/LibreChat-AI/LibreChat/f10b1d91f1eee3a2c82d5247bf620351486b7c1b/packages/api/src/endpoints/google/initialize.ts "Initializes Google/Vertex AI endpoint configuration."
    clientCasesNone: 'No demanded application uses the official Web Risk SDK: LibreChat configures Vertex AI, and Runhuman 1 is outside the demand.',
    // source: spec:SearchUris "webrisk.googleapis.com"
    hosts: [{ host: 'webrisk.googleapis.com' }],
    endpointEnvNone: 'No demanded application configures a Web Risk endpoint; the World routes the declared vendor host.',
  },
};
