// Amazon S3's manifest (the aws pack's s3 lane): the facts AWS's Smithy model does not carry (architecture, "Protocol 3",
// in twin-world). The surface is generated (./generated/surface.gen.json) from ../spec (AWS's S3 model, 2006-03-01).
// Every served operation is a handler (./semantics/operations.ts) over S3's wire as the kernel has it (world-core's
// `s3`); every other operation is the gap (501 NotImplemented).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  tenant: { field: '_world_account', storage: 'namespaced' },
  vendor: 'aws',
  service: 'aws',
  body: {},
  ids: { template: '{prefix}{n}', acceptProvided: true },
  time: 'iso',
  // a virtual-hosted request names its bucket by its host (`<bucket>.s3[.<region>].amazonaws.com/<key>`), routed as its
  // path-style form; its signature stays over the path it sent
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html "In a virtual-hosted–style URI, the bucket name is part of the domain name in the URL."
  pathFromHost: '^(.+)\\.s3(?:[.-][a-z0-9-]+)?(?:\\.dualstack\\.[a-z0-9-]+)?\\.amazonaws\\.com$',
  // a vendor-backed World sends S3's calls to its Regional endpoint, path-style, in us-east-1, the Region the World's
  // application key is issued for (../../src/semantics/shared.ts) and the account's buckets are made in
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html "the bucket for the request will be the first slash-delimited component of the Request-URI"
  remoteHost: { template: 's3.us-east-1.amazonaws.com' },
  // what an object is put with and answers again (its system headers, its metadata, its tags, its encryption, its storage
  // class, its checksums), and a copy's source and directive: recorded with the write so a vendor-backed World sends them
  // again
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html "x-amz-meta-"
  headers: ['content-type', 'content-md5', 'cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires',
    'x-amz-meta-*', 'x-amz-checksum-*', 'x-amz-sdk-checksum-algorithm', 'x-amz-storage-class', 'x-amz-server-side-encryption', 'x-amz-tagging',
    'x-amz-acl', 'x-amz-copy-source', 'x-amz-metadata-directive'],
  // S3's error body (https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html): an XML Error with Code and Message
  error: '<?xml version="1.0" encoding="UTF-8"?><Error><Code>{code}</Code><Message>{message}</Message></Error>',
  // an operation the lane does not serve: S3's answer to a header implying functionality it does not implement
  gap: { status: 501, code: 'NotImplemented', message: 'A header you provided implies functionality that is not implemented' },
  defaultKind: 'InvalidRequest',
  readOnly: { status: 403, code: 'AccessDenied', message: 'Access Denied: this twin is read-only.' },
  notFound: { status: 404, code: 'NoSuchKey', message: 'The specified key does not exist.' },
  list: { style: 'envelope', envelope: { ListBucketResult: { Contents: '{data}' } }, limit: { param: 'max-keys', default: 1000, max: 1000 } },
  deleted: {},
  // No out-of-scope Smithy operation answers a key of resources below; those operations take the gap.
  unmodeled: [],

  // the World's doors (./semantics/doors.ts)
  doors: [{ id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the access key the World's application holds, as the runtime issues it at every boot" }],
  // SigV4 (spec: `aws.auth#sigv4`): the credential names its signer, and the front (./semantics/around.ts) verifies the
  // signature against the key the World issued
  auth: {
    header: 'authorization', scheme: 'AWS4-HMAC-SHA256', gateWhenAbsent: false, invalidKeys: [],
    missing: { status: 403, code: 'AccessDenied', message: 'Access Denied' },
    invalid: { status: 403, code: 'InvalidAccessKeyId', message: 'The AWS Access Key Id you provided does not exist in our records.' },
  },
  resources: {
    // the sequence an upload's id is drawn over (ctx.issue, ./semantics/operations.ts)
    _seq_upload: { idPrefix: '', ids: '{n}' },
    // a bucket, by its name, as ListBuckets answers it; read back by ListBuckets, a page at a time
    // source: spec:/shapes/com.amazonaws.s3#ListBucketsOutput "ContinuationToken"
    Bucket: {
      // Bucket names are a vendor-wide namespace; every operation except public CORS checks its owner.
      shared: true, storedAs: 's3_bucket', idPrefix: '', idAs: 'Name',
      // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The requested bucket name is not available."
      unique: [{ fields: ['Name'], refusal: { status: 409, code: 'BucketAlreadyExists', message: 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.' } }],
      notFound: { code: 'NoSuchBucket', message: 'The specified bucket does not exist' },
      refresh: { list: 'ListBuckets', items: 'ListAllMyBucketsResult.Buckets.Bucket', next: 'ListAllMyBucketsResult.ContinuationToken', cursor: 'continuation-token' },
    },
    // an object, `<bucket>/<key>`, as ListObjectsV2 answers it under its bucket; read back by ListObjectsV2, bucket by
    // bucket, a page at a time while it is truncated; its bytes, which the list does not carry, read by GetObject with
    // the headers it answers them with
    // source: spec:/shapes/com.amazonaws.s3#ListObjectsV2 "Returns some or all (up to 1,000) of the objects in a bucket with each request."
    // source: spec:/shapes/com.amazonaws.s3#ListObjectsV2Output "NextContinuationToken"
    // source: spec:/shapes/com.amazonaws.s3#GetObject "Retrieves an object from Amazon S3."
    Object: {
      storedAs: 's3_object', idPrefix: '', key: '{_bucket}/{Key}', ...states.Object,
      parent: { param: 'Bucket', field: '_bucket', resource: 'Bucket' },
      refresh: {
        list: 'ListObjectsV2', items: 'ListBucketResult.Contents', next: 'ListBucketResult.NextContinuationToken', cursor: 'continuation-token', more: 'ListBucketResult.IsTruncated',
        blobs: [{ operation: 'GetObject', field: '_blob', headers: { 'x-amz-checksum-mode': 'ENABLED' }, headersField: '_headers',
          keepHeaders: ['content-type', 'cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires', 'x-amz-meta-*',
            'x-amz-server-side-encryption', 'x-amz-tagging-count', 'x-amz-checksum-*'] }],
      },
    },
    // an upload in progress, by its UploadId, as ListMultipartUploads answers it under its bucket; read back by
    // ListMultipartUploads, a page at a time by its two markers while it is truncated
    // source: spec:/shapes/com.amazonaws.s3#ListMultipartUploads "This operation lists in-progress multipart uploads in a bucket."
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html "Set the value of key-marker to the NextKeyMarker value from the previous response."
    Upload: {
      storedAs: 's3_upload', idPrefix: '', idAs: 'UploadId', ...states.Upload,
      parent: { param: 'Bucket', field: '_bucket', resource: 'Bucket' },
      refresh: { list: 'ListMultipartUploads', items: 'ListMultipartUploadsResult.Upload', more: 'ListMultipartUploadsResult.IsTruncated',
        next: { 'key-marker': 'ListMultipartUploadsResult.NextKeyMarker', 'upload-id-marker': 'ListMultipartUploadsResult.NextUploadIdMarker' } },
    },
    // a part of an upload, `<upload>:<number>`, as ListParts answers it; read back by ListParts under each upload, a page
    // at a time while it is truncated. A part names no bytes a read could take back (no operation downloads a part).
    // source: spec:/shapes/com.amazonaws.s3#ListParts "Lists the parts that have been uploaded for a specific multipart upload."
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListParts.html "include the part-number-marker query string parameter and set its value to the NextPartNumberMarker field value from the previous response."
    Part: {
      storedAs: 's3_part', idPrefix: '', key: '{_upload}:{PartNumber}',
      parent: { params: ['Bucket', 'Key'], param: 'uploadId', where: { _bucket: '{Bucket}', Key: '{Key}', UploadId: '{uploadId}' }, value: '{uploadId}', field: '_upload', resource: 'Upload' },
      refresh: { list: 'ListParts', items: 'ListPartsResult.Part', next: 'ListPartsResult.NextPartNumberMarker', cursor: 'part-number-marker', more: 'ListPartsResult.IsTruncated' },
    },
  },
};
