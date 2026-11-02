# @volter/twin-aws

The AWS twin (Protocol 3): one vendor of many APIs, each a lane derived from AWS's own Smithy model (`s3/spec`,
`secretsmanager/spec`, provenance in each `SOURCE.md`). A request goes to Secrets Manager when its `X-Amz-Target` or its
host names it, and to S3 otherwise (`src/manifest.ts`, the lanes' routes). Every other AWS API is neither modelled nor
claimed.

| lane | what it serves | its wire |
|---|---|---|
| S3 (`s3/`) | the platform’s demanded backups and Larkspur’s configured LibreChat, Twenty and Rallly storage (third-party opt-ins) ([journeys/demand.json](./journeys/demand.json)): `CreateBucket`, `HeadBucket`, `PutObject` (presigned too; its metadata, tags, storage class and encryption kept; Content-MD5 and `x-amz-checksum-*` checked), `GetObject` (presigned too, with its response overrides; one byte range; its checksums when asked), `HeadObject`, `CopyObject`, `DeleteObject`, `DeleteObjects`, `ListObjectsV2` (prefixes, delimiters, pages), and multipart uploads (`CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload` with S3's part rules, `AbortMultipartUpload`); `ListBuckets`, `ListMultipartUploads` and `ListParts`, which a vendor-backed World reads its buckets, uploads and parts back by, and `PutBucketCors`, which opens a bucket to Twenty's browser uploads; path-style or virtual-hosted; the bytes in the World's blob store | restXml, S3's XML errors; any other operation is S3's 501 `NotImplemented` |
| Secrets Manager (`secretsmanager/`) | no application of the demand calls it; the life and AWS's published examples reach it: secrets, their versions and staging labels, rotation on the World clock (the invocations a rotation function would have been sent are a door), resource policies, replication, tags, a random password | AWS JSON 1.1, `__type` errors |

## Credentials

Every request is verified by its SigV4 signature (the kernel's `verifySigV4`), over the bytes it carried: the header form
or a presigned URL, against an access key the World issued. Its Secret Access Key is drawn from a secret the World holds
for the key's id, so it is kept nowhere and no one computes it (`src/semantics/shared.ts`). An unsigned request, a key the
World never issued, a wrong signature and an expired presigned URL are each refused as the lane's API refuses them (S3's
`AccessDenied`, `InvalidAccessKeyId`, `SignatureDoesNotMatch`; Secrets Manager's `MissingAuthenticationTokenException`,
`UnrecognizedClientException`, `InvalidSignatureException`). No bucket is public.

The World's application is issued its key when the World boots: `POST /_twin/app-credentials` (the descriptor's
credential door) answers `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, the same key at every boot, for us-east-1. The
SDKs reach the twin through `AWS_ENDPOINT_URL` or the World's host interception.

## Doors

- `POST /_twin/app-credentials`: the application's access key (IAM's console makes one; no S3 or Secrets Manager call does).
- `GET /_twin/rotation-invocations?secret=<id>[&step=<Step>]`: the calls Secrets Manager made to a secret's rotation
  function, newest first (no World runs the function).

## Against the real AWS

A World whose root is AWS performs its writes against it and refreshes what it reads, each lane's calls signed with
SigV4 by the root's access key for that lane's service and sent to its own Regional endpoint, in us-east-1
(`s3.us-east-1.amazonaws.com`, path-style; `secretsmanager.us-east-1.amazonaws.com`). It reads back buckets by
`ListBuckets`, objects by `ListObjectsV2` with each object's bytes and headers by `GetObject`, uploads in progress by
`ListMultipartUploads` and their parts by `ListParts`, each page by page, and secrets by `ListSecrets` (an RPC list, its
`NextToken` the cursor, with scheduled deletions included), followed by `DescribeSecret` for each ARN to retain its complete metadata shape. A write sends again the headers it was made with (an object's type, metadata, tags, checksums, a
copy's source). AWS sends no signed events here, so there is no ingest. The rate budget is 1,000 calls a minute, under
Secrets Manager's lowest documented allowance (50 writes a second; the manifest cites each page).

## Left out

- Every other AWS API (SES, Lambda, STS, Bedrock, CloudFront and the rest): they answer as AWS answers an API it does not
  have here.
- S3 operations outside the demand, life and refresh scope: versioning, Object Lock,
  ACLs (a request carrying one other than the owner's full control is refused, as a new bucket's disabled ACLs refuse
  it), bucket policies, lifecycle, deleting a bucket, `UploadPartCopy`, `ListObjects` (v1), among them.
- A payload sent in S3's aws-chunked framing (`x-amz-content-sha256: STREAMING-…`, an SDK streaming a body of unknown
  length with a checksum trailer) is answered `NotImplemented`: the lane does not decode it. The demanded applications
  send whole bodies (LibreChat and Rallly with `requestChecksumCalculation: WHEN_REQUIRED`).
- A vendor-backed root in a Region other than us-east-1: the root's signing scope is the manifest's data, one Region.
- A bucket's CORS rules are not read back by a refresh (`GetBucketCors` is not served).

## Journeys

`journeys/`, one life for the vendor: Larkspur's files in S3 from the twin platform's backups, Rallly, Twenty (browser
uploads behind the bucket's CORS) and LibreChat, and its Secrets Manager acts, on one clock; the vendor's published
examples of both lanes beside it (`journeys/vendor-examples.json`). Each step is signed with the issued key (the walk's
`sigv4`, or `presign` for a presigned URL).
