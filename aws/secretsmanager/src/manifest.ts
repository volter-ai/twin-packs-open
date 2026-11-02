// AWS SECRETS MANAGER — a Protocol 3 lane of the aws pack (docs/contributing/architecture.md, "Protocol 3"). Its
// surface is generated from AWS's Smithy model (spec/smithy.json.gz, AWS JSON 1.1: every operation a POST to `/`
// named by `X-Amz-Target: secretsmanager.<Operation>`); this manifest holds what the model does not say (errors,
// the secret's lifecycle, in semantics/states.ts) and semantics/operations.ts how the service behaves.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  tenant: { field: '_world_account', storage: 'namespaced' },
  vendor: 'aws',
  // the store it shares with the other lanes: AWS's access keys are one account's, whatever API they sign for
  service: 'aws',
  body: { json: 'always' },
  ids: { template: '{prefix}{n}' },
  time: 'unix',
  // a vendor-backed World sends Secrets Manager's calls to its own Regional endpoint, in us-east-1, the Region the World's
  // application key is issued for (../../src/semantics/shared.ts)
  // source: https://docs.aws.amazon.com/general/latest/gr/asm.html "secretsmanager.us-east-1.amazonaws.com"
  remoteHost: { template: 'secretsmanager.us-east-1.amazonaws.com' },
  // AWS JSON's error: the exception's name as __type, and its message
  error: { __type: '{code}', Message: '{message}' },
  // a target the service does not have, as AWS answers it
  gap: { status: 400, code: 'UnknownOperationException', message: '' },
  // the World's door (./semantics/doors.ts): the invocations Secrets Manager sent a secret's rotation function
  doors: [{ id: 'rotationInvocations', method: 'GET', path: '/_twin/rotation-invocations', note: '?secret=<id>[&step=<Step>]: newest first' }],
  defaultKind: 'InvalidRequestException',
  readOnly: { status: 400, code: 'AccessDeniedException', message: 'This twin is read-only; write operations are not allowed.' },
  notFound: { status: 400, code: 'ResourceNotFoundException', message: "Secrets Manager can't find the specified secret." },
  list: { style: 'envelope', envelope: { SecretList: '{data}', NextToken: '{next}' }, limit: { param: 'MaxResults', default: 100, max: 100 } },
  deleted: {},
  // an Authorization header that is not a SigV4 one is refused as AWS refuses it; the signature itself, and an unsigned
  // call, are the front's (./semantics/around.ts)
  auth: {
    header: 'authorization',
    scheme: 'AWS4-HMAC-SHA256',
    gateWhenAbsent: false,
    missing: { status: 400, code: 'MissingAuthenticationTokenException', message: 'Missing Authentication Token' },
    invalidKeys: [],
    invalid: { status: 403, code: 'UnrecognizedClientException', message: 'The security token included in the request is invalid.' },
  },
  // every answer names its request by a GUID; AWS mints one per request, and the kernel's answer headers are fixed values,
  // so a World's is one fixed UUID
  // source: https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html "x-amzn-RequestId: <request-id-guid>"
  answerHeaders: { 'x-amzn-requestid': '9b2f6c1e-4d7a-4e0b-8c3f-5a6d7e8f9a0b' },
  resources: {
    // Issued ids for nested versions, opaque rotation tokens, and the ARN's six-character suffix.
    _version: { idPrefix: '', ids: '{uuid}' },
    _rotation: { idPrefix: '', ids: '{uuid}' },
    _secret_suffix: { idPrefix: '', ids: '{letters:6}' },
    _seq_password: { idPrefix: '', ids: '{n}' },
    // the stored secret, in DescribeSecret's shape, named to the vendor by its ARN; its versions and resource policy are
    // bookkeeping on it. ListSecrets returns summaries; DescribeSecret supplies the complete stored metadata, not values.
    Secret: {
      storedAs: 'secret',
      idPrefix: 'secret',
      idAs: 'ARN',
      ...states.Secret,
      // source: spec:/shapes/com.amazonaws.secretsmanager#ListSecretsRequest/members/IncludePlannedDeletion "Specifies whether to include secrets scheduled for deletion."
      refresh: { list: 'ListSecrets', items: 'SecretList', next: 'NextToken', query: { IncludePlannedDeletion: 'true' }, detail: 'DescribeSecret', detailWith: { SecretId: '{ARN}' } },
    },
  },
};
