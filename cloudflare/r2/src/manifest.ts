// Authored from R2's S3 compatibility reference and the vendored Smithy wire model.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

// cast, not typed: the lane declares no core `list` or `deleted` envelope, which DerivedManifest requires, because its
// handlers answer every S3 list and delete in S3's XML (./semantics)
export const manifest = {
  vendor: 'cloudflare', service: 'cloudflare',
  hosts: [{ suffix: '.r2.cloudflarestorage.com' }],
  pathFromHost: '^([^.]+)\\.[0-9a-f]{32}(?:\\.(?:eu|fedramp-high|fedramp|us))?\\.r2\\.cloudflarestorage\\.com$',
  // the account (and the jurisdiction) a call names by its host, as the write records it: a vendor-backed World sends
  // it to that host again (architecture, "Lanes")
  // source: https://developers.cloudflare.com/r2/api/s3/api/ "The API is available via the https://<ACCOUNT_ID>.r2.cloudflarestorage.com endpoint."
  // source: https://developers.cloudflare.com/r2/reference/data-location/ "you must specify the jurisdiction in your S3 endpoint:"
  hostParams: '^(?:[^.]+\\.)?(?<account_id>[0-9a-f]{32})(?:\\.(?<jurisdiction>eu|fedramp-high|fedramp|us))?\\.r2\\.cloudflarestorage\\.com$',
  remoteHost: { template: '{account_id}{jurisdiction}.r2.cloudflarestorage.com', values: { jurisdiction: { '': '', default: '', eu: '.eu', us: '.us', fedramp: '.fedramp', 'fedramp-high': '.fedramp-high' } } },
  // what an object is put with and answers again (its type and system headers, its metadata, its checksums), and a
  // write's preconditions and copy source: recorded with the write so a vendor-backed World sends them again
  headers: ['content-type', 'content-md5', 'cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires',
    'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since', 'x-amz-meta-*', 'x-amz-checksum-*', 'x-amz-sdk-checksum-algorithm',
    'x-amz-storage-class', 'x-amz-server-side-encryption-customer-algorithm', 'x-amz-server-side-encryption-customer-key-md5', 'x-amz-copy-source', 'x-amz-copy-source-if-match', 'x-amz-copy-source-if-none-match', 'x-amz-copy-source-if-modified-since',
    'x-amz-copy-source-if-unmodified-since', 'x-amz-metadata-directive', 'cf-create-bucket-if-missing'],
  body: {}, ids: { template: '{hex:32}', acceptProvided: true }, time: 'iso',
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "The specified object key does not exist."
  error: '<?xml version="1.0" encoding="UTF-8"?><Error><Code>{code}</Code><Message>{message}</Message></Error>',
  defaultKind: 'InvalidRequest',
  notFound: { status: 404, code: 'NoSuchKey', message: 'The specified object key does not exist.' },
  readOnly: { status: 403, code: 'AccessDenied', message: 'The World is read-only.' },
  // The around hook verifies both header and query SigV4 before dispatch. The core must permit the query form.
  auth: { header: 'authorization', scheme: 'AWS4-HMAC-SHA256', gateWhenAbsent: false, invalidKeys: [],
    missing: { status: 401, code: 'Unauthorized', message: 'Missing or invalid authentication credentials.' },
    invalid: { status: 401, code: 'Unauthorized', message: 'Missing or invalid authentication credentials.' } },
  resources: {
    Bucket: { storedAs: 'r2_bucket', idPrefix: '', ...states.Bucket,
      notFound: { status: 404, code: 'NoSuchBucket', message: 'The specified bucket does not exist.' },
      refresh: { none: "the API lane's Bucket (the same stored type) is read back by r2-list-buckets, under its account: an S3 bucket list names no account" } },
    // a bucket's objects and in-progress uploads, and an upload's parts, read back under their parent as S3 lists them
    // (XML read as JSON): an object kept as `<account>:<bucket>/<key>`, an upload by its id, a part as `<upload>:<number>`
    // source: spec:/shapes/com.amazonaws.s3#ListObjectsV2 "Returns some or all (up to 1,000) of the objects in a bucket with each request."
    // its bytes, which the list does not carry, read by GetObject with the headers it answers them with (./semantics/shared.ts
    // SYSTEM_HEADERS, its metadata, its checksums when asked)
    // source: spec:/shapes/com.amazonaws.s3#ListObjectsV2Output "if all of the results were returned."
    // source: spec:/shapes/com.amazonaws.s3#GetObject "Retrieves an object from Amazon S3."
    Object: { storedAs: 'r2_object', idPrefix: '', ...states.Object, key: '{_bucket}/{Key}',
      parent: { params: ['Bucket'], where: { name: '{Bucket}', account_id: '{account_id}', jurisdiction: '{jurisdiction}' }, value: '{account_id}:{Bucket}', field: '_bucket', resource: 'Bucket' },
      refresh: { list: 'ListObjectsV2', items: 'ListBucketResult.Contents', next: 'ListBucketResult.NextContinuationToken', cursor: 'continuation-token', more: 'ListBucketResult.IsTruncated',
        blobs: [{ operation: 'GetObject', field: '_blob', headers: { 'x-amz-checksum-mode': 'ENABLED' }, headersField: '_headers',
          keepHeaders: ['content-type', 'cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires', 'x-amz-meta-*', 'x-amz-checksum-*'] }] } },
    // source: spec:/shapes/com.amazonaws.s3#ListMultipartUploads "This operation lists in-progress multipart uploads in a bucket."
    // source: spec:/shapes/com.amazonaws.s3#ListMultipartUploadsOutput "this element specifies the value that should be used for the key-marker"
    Multipart: { storedAs: 'r2_multipart', idPrefix: '', ...states.Multipart, idAs: 'UploadId',
      parent: { params: ['Bucket'], where: { name: '{Bucket}', account_id: '{account_id}', jurisdiction: '{jurisdiction}' }, value: '{account_id}:{Bucket}', field: '_bucket', resource: 'Bucket', keep: { _jurisdiction: '{jurisdiction}' } },
      refresh: { list: 'ListMultipartUploads', items: 'ListMultipartUploadsResult.Upload', more: 'ListMultipartUploadsResult.IsTruncated',
        next: { 'key-marker': 'ListMultipartUploadsResult.NextKeyMarker', 'upload-id-marker': 'ListMultipartUploadsResult.NextUploadIdMarker' } } },
    // source: spec:/shapes/com.amazonaws.s3#ListParts "Lists the parts that have been uploaded for a specific multipart upload."
    // a part names no bytes a read could take back: an observed part completes nothing (the README)
    // source: spec:/shapes/com.amazonaws.s3#ListPartsOutput "this element specifies the last part in the list, as well as the value to"
    Part: { storedAs: 'r2_part', idPrefix: '', key: '{_upload}:{PartNumber}',
      parent: { params: ['Bucket', 'Key'], param: 'uploadId', where: { _bucket: '{account_id}:{Bucket}', Key: '{Key}', UploadId: '{uploadId}', _jurisdiction: '{jurisdiction}' }, value: '{uploadId}', field: '_upload', resource: 'Multipart' },
      refresh: { list: 'ListParts', items: 'ListPartsResult.Part', next: 'ListPartsResult.NextPartNumberMarker', cursor: 'part-number-marker', more: 'ListPartsResult.IsTruncated' } },
    CustomDomain: { storedAs: 'r2_custom_domain', idPrefix: '', refresh: { none: "the API lane's CustomDomain (the same stored type) is read back by r2-list-custom-domains under its bucket" } },
    ApiToken: { storedAs: 'api_token', idPrefix: '', refresh: { none: "the API lane's tokens (its iam_token_base, the same stored type) are read back by its list; a token's value is shown once" } },
    User: { storedAs: 'cf_user', idPrefix: '', refresh: { none: "the API lane's person (its iam_single_user_response, the same stored type) is read back by user-user-details" } },
    TemporaryCredential: { storedAs: 'r2_temporary_credential', idPrefix: '', refresh: { none: 'R2 lists no temporary credentials: each is answered once, at its creation, and expires' } },
  },
  screens: [
    { id: 'login', kind: 'flow', host: 'dash.cloudflare.com', path: '/login', status: 'done',
      demand: 'The dashboard asks a person to sign in before its token pages (Open Autonomy setup, R2 credentials).', controls: ['Email', 'Password', 'Log in'],
      source: 'https://developers.cloudflare.com/fundamentals/user-profiles/login/' },
    { id: 'profile-api-tokens', kind: 'workspace', host: 'dash.cloudflare.com', path: '/profile/api-tokens', status: 'done',
      demand: 'Open Autonomy opens this path with permissionGroupKeys and name for its one-account deployment token.',
      controls: ['Create Token', 'Roll', 'Delete'], source: 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/' },
    { id: 'api-tokens', kind: 'workspace', host: 'dash.cloudflare.com', path: '/{account_id}/r2/api-tokens', status: 'done',
      demand: "R2's S3 credentials for Dub, Postiz and RH2's recording storage are made here (an Account API token's id and the SHA-256 of its value).", controls: ['Create Account API token', 'Create User API token', 'Revoke'],
      source: 'https://developers.cloudflare.com/r2/api/tokens/' },
    { id: 'workers-and-pages', kind: 'workspace', host: 'dash.cloudflare.com', path: '/{account_id}/workers-and-pages', status: 'done',
      demand: "A Worker deployed with wrangler (volter-ai/sites' sites, each on its Custom Domain) is found here, and its site opened from its domain.",
      controls: ['Visit'], source: 'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/' },
    // the dashboard's root, last: every other screen's path is more particular than it
    { id: 'dashboard', kind: 'workspace', host: 'dash.cloudflare.com', path: '/', status: 'done',
      demand: "Cloudflare's documentation links each dashboard step as `?to=/:account/<page>`, opened in the signed-in person's account.",
      source: 'https://developers.cloudflare.com/workers/configuration/routing/custom-domains/' },
  ],
  doors: [
    { id: 'users', method: 'POST', path: '/_twin/users/{email}', note: 'Stand-in for a person completing Cloudflare sign-up; never creates tokens, zones or buckets.' },
    { id: 'hosts', method: 'GET', path: '/_twin/hosts', note: 'The router reads attached R2 public domains and Workers Custom Domains; this gives no credential or DNS proof.' },
  ],
  // R2 documents 501 for unsupported features in its release notes. Applying that class to an unserved operation is
  // this lane's explicit reading; the compatibility table has no general unknown-operation response example.
  gap: { status: 501, code: 'NotImplemented', message: 'Not Implemented' },
} as unknown as DerivedManifest;
