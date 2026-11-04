# aws/s3 spec — provenance

- **File:** `smithy.json.gz`, gzip (`gzip -9 -n`) of AWS's published Smithy JSON AST for Amazon S3.
- **Upstream:** https://github.com/aws/api-models-aws, `models/s3/service/2006-03-01/s3-2006-03-01.json` at commit
  `9b1a4929274443d8671ea8acfda7afbe856e29e9`, fetched 2026-09-26 (the cloudflare pack's R2 lane vendors the same bytes).
- **Spec version:** `2006-03-01` (`com.amazonaws.s3#AmazonS3`); protocol `aws.protocols#restXml`, auth `aws.auth#sigv4`;
  112 operations.
- **SHA-256 of the uncompressed document:** `e632755547997bbfbde67d5630d6f09601c909ed9026713e5ff3f71887ab4892`.
- **SHA-256 of the vendored bytes:** `smithy.json.gz` `b9cb47ca301728f33c01dee7b25b81ec6f1323a0eb90552da0e5de1a4f5d3321`.
- **Corrections:** `patches.json`, eleven: the model's `x-id=<Operation>` query literal dropped from the URIs of
  AbortMultipartUpload, CopyObject, DeleteObject, GetObject, ListBuckets, ListParts, PutObject, UploadPart, UploadPartCopy,
  GetObjectAnnotation and ListObjectAnnotations, each as its S3 API reference page gives the request line (with no x-id),
  so a request distinguishes them by its required query parameters and headers as S3 does (the cloudflare pack's R2 lane
  carries the same corrections of the same bytes).
- **Published examples beside the model:** `doc-examples.json`, copied from S3's pages as their rendered text reads
  (`twin-standard read-page`): the CreateBucket page's request setting a bucket's Region (API_CreateBucket.html), and the
  rules the pages state, replayed as the refusals they cause (API_Error.html, API_PutObject.html, API_CompleteMultipartUpload.html,
  the user guide's object-keys.html and qfacts.html).
- **Read by:** `bun <twin-world>/scripts/derive-pack.ts <this lane>`; the twin orchestrator, 2026-09-29.
