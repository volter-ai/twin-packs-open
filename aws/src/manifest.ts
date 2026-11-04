// AWS's manifest: one vendor of many APIs, each a lane of its own AWS model (architecture, "Other wires: lanes"). Built:
// Secrets Manager (../secretsmanager) and S3 (../s3); every other AWS API is not modelled and not claimed. Secrets
// Manager is AWS JSON 1.1, named by its `X-Amz-Target` (`secretsmanager.<Operation>`) or its own host; everything else
// is S3's restXml, which takes a host's or a path's bucket.
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'aws',
  discovery: {
    twinOf: 'AWS: Secrets Manager (AWS JSON 1.1) and S3 (buckets and objects over restXml), SigV4-signed',
    stores: "secrets with their versions, staging labels and rotations; S3 buckets, objects (their bytes in the World's blob store), and multipart uploads in progress with their parts",
  },
  lanes: {
    routes: [
      { lane: 'secretsmanager', header: { name: 'x-amz-target', prefix: 'secretsmanager.' } },
      { lane: 'secretsmanager', host: '^secretsmanager(-fips)?\\.' },
    ],
    default: 's3',
  },
  // AWS's documented allowances, per second: S3's per prefix, Secrets Manager's per operation and Region (its lowest, 50
  // a second, for every write). One minute's window at the kernel's ceiling of 1,000 calls (under 17 a second) stays under
  // the lowest of them; a Retry-After past five minutes is the credential in trouble.
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html "your application can achieve at least 3,500 PUT/COPY/POST/DELETE or 5,500 GET/HEAD requests per second per partitioned Amazon S3 prefix"
  // source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html "Rate of CreateSecret API requests Each supported Region: 50 per second"
  // source: https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html "Rate of GetSecretValue API requests Each supported Region: 10,000 per second"
  rateBudget: {
    reason: "S3 allows at least 3,500 PUT/COPY/POST/DELETE or 5,500 GET/HEAD requests a second per prefix (https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html); Secrets Manager allows 50 a second for each of its writes and up to 10,000 for GetSecretValue, per Region (https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html). A minute's window at the kernel's ceiling of 1,000 calls, under 17 a second, is under the lowest of them.",
    windowMs: 60_000, ceiling: 1_000, defaultWeight: 1, maxRetryAfterSeconds: 300,
    // the lowest allowance documented: Secrets Manager's 50 writes a second, 3,000 a minute
    allowance: { perMinute: 3_000, source: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_limits.html' },
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    // a vendor-backed World's root: each lane's calls signed with SigV4 by the root's access key (its `keyId` and `secret`),
    // scoped to the lane's service in us-east-1, where its calls go (each lane's remoteHost)
    // source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html "CredentialScope – The credential scope, which restricts the resulting signature to the specified Region and service."
    auth: { in: 'lanes', lanes: {
      s3: { in: 'signature', algorithm: 'aws-sigv4', scope: { region: 'us-east-1', service: 's3' } },
      secretsmanager: { in: 'signature', algorithm: 'aws-sigv4', scope: { region: 'us-east-1', service: 'secretsmanager' } },
    } },
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-aws',
    resources: ['secret', 's3_bucket', 's3_object', 's3_upload', 's3_part'],
    specSource: 'AWS\'s Smithy models: secretsmanager/spec and s3/spec (provenance in each SOURCE.md)',
    description: 'AWS twin — Secrets Manager (secrets, versions and staging labels, rotation on the World clock) and S3 (buckets made, found, listed and opened to browser uploads by their CORS; objects put with their metadata and checksums, read through presigned URLs and by byte range too, found, copied, deleted, deleted in a batch, listed with prefixes and delimiters, and uploaded in parts, uploads and parts listed), every request\'s SigV4 signature verified against an access key the World issued, from AWS\'s own models.',
    // its routing identities are World identities too: a World names each lane's twin as SECRETSMANAGER_TWIN_URL and S3_TWIN_URL
    adoption: { sdks: ['@aws-sdk/client-secrets-manager', '@aws-sdk/client-s3'], pypi: [], envStems: ['AWS'], worldIds: ['secretsmanager', 's3'] },
    hosts: [
      { key: 's3', host: 's3.amazonaws.com' },
      { key: 'secretsmanager', hostPattern: '^secretsmanager(-fips)?\\.[a-z0-9-]+\\.amazonaws\\.com$' },
      { key: 's3', suffix: '.s3.amazonaws.com' },
      { key: 's3', hostPattern: '^s3[.-][a-z0-9-]+\\.amazonaws\\.com$' },
      { key: 's3', hostPattern: '\\.s3[.-][a-z0-9-]+\\.amazonaws\\.com$' },
    ],
    // the application's access key, issued once the twin is up (./semantics/shared.ts issueAppCredentials), under the names the AWS
    // SDKs read (https://docs.aws.amazon.com/sdkref/latest/guide/feature-static-credentials.html)
    credentialDoor: { account: { field: 'account', tenancy: 'AWS account', source: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html' }, deployment: { field: 'deployment', object: 'IAM workload user/access key', source: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html' }, path: '/_twin/app-credentials', body: {}, fill: { AWS_ACCESS_KEY_ID: 'access_key_id', AWS_SECRET_ACCESS_KEY: 'secret_access_key', AWS_ACCESS_KEY: 'access_key_id', AWS_SECRET_KEY: 'secret_access_key' } },
    // the AWS SDKs take a service endpoint from AWS_ENDPOINT_URL (the platform's backups pass it, path-style)
    endpointEnv: { name: 'AWS_ENDPOINT_URL', note: 'The AWS SDKs read AWS_ENDPOINT_URL as every service\'s endpoint (https://docs.aws.amazon.com/sdkref/latest/guide/feature-ss-endpoints.html).' },
  },
};
