// R2's S3 operations (every one is the spec's `operations` family: its paths are /{Bucket} and /{Bucket}/{Key}):
// buckets, their CORS and lifecycle, objects, listings and multipart uploads, over exact kernel blobs and S3's XML.
import type { HandlerContext } from '@volter/world-core';
import { ofBucket, bucketNamed, sameAccount, s3, BUCKET, UPLOAD, DOMAIN, bucketKey, bucketNameValid, bucketOf, uploadBucket, ownerXml, here, objectsOf, putBucket, noBucket, error, invalid, xmlBody, discardUpload, listObjects, OBJECT, objectOf, objectKey, keyValid, payload, checksumFields, metadataOf, metadataRefusal, storageClassOf, keyAllowed, conditions, sourceOf, writeObject, readObject, noObject, PART, uploadOf, partsOf, rangeOf, noUpload, putPart, listUploads, type Row, customerEncryption, heldEncryption, encryptionHeaders, CHECKSUMS, missingObjectBlob } from './shared.ts';

// source: spec:/shapes/com.amazonaws.s3#CreateBucket "Creates a new S3 bucket."
export async function CreateBucket(ctx: HandlerContext): Promise<Response> {
  const endpoint = here(ctx); const name = String(ctx.call.params.Bucket ?? '');
  if (!bucketNameValid(name)) return error('InvalidBucketName', 'Bucket name does not meet naming requirements.', 400);
  const existing = bucketNamed(ctx, endpoint.account, name);
  if (existing) return error('BucketConflict', 'Bucket name already exists.', 409);
  // the region is auto (an empty one and us-east-1 alias it); a location hint rides the same constraint
  // source: https://developers.cloudflare.com/r2/api/s3/api/ "us-east-1"
  // source: https://developers.cloudflare.com/r2/reference/data-location/ "You can set the Location Hint via the LocationConstraint parameter using the S3 API:"
  const location = s3.locationConstraintOf(await xmlBody(ctx))?.toLowerCase();
  const hint = location !== undefined && ['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc'].includes(location) ? location : null;
  if (location !== undefined && !hint && !['', 'auto', 'us-east-1'].includes(location)) return invalid('The bucket region is auto.');
  await putBucket(ctx, endpoint.account, name, endpoint.jurisdiction, hint);
  return new Response(null, { status: 200, headers: { location: `/${name}` } });
}
// source: spec:/shapes/com.amazonaws.s3#ListBuckets "Returns a list of all buckets owned by the authenticated sender of the request."
export async function ListBuckets(ctx: HandlerContext): Promise<Response> {
  const endpoint = here(ctx);
  const buckets = ctx.rowsRaw(BUCKET).filter(bucket => sameAccount(ctx, bucket.account_id, endpoint.account) && bucket.jurisdiction === endpoint.jurisdiction)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // R2's owner is the account: its aws-cli example prints the owner's DisplayName and ID as one account id
  // source: https://developers.cloudflare.com/r2/examples/aws/aws-cli/ "134a5a2c0ba47b38eada4b9c8ead10b6"
  return s3.xmlAnswer(s3.doc('ListAllMyBucketsResult', [ownerXml(endpoint.account),
    s3.x('Buckets', buckets.map(bucket => s3.x('Bucket', [s3.x('Name', String(bucket.name)), s3.x('CreationDate', String(bucket.creation_date))])))]));
}
// source: spec:/shapes/com.amazonaws.s3#HeadBucket "You can use this operation to determine if a bucket exists"
export async function HeadBucket(ctx: HandlerContext): Promise<Response> {
  return new Response(null, { status: bucketOf(ctx) ? 200 : 404, headers: { 'x-amz-bucket-region': 'auto' } });
}
// source: https://developers.cloudflare.com/r2/api/error-codes/ "Cannot delete bucket that contains objects."
export async function DeleteBucket(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  if (objectsOf(ctx, bucket).length) return error('BucketNotEmpty', 'Cannot delete bucket that contains objects.', 409);
  for (const upload of ctx.rowsRaw(UPLOAD).filter(row => ofBucket(ctx, row._bucket, bucket))) await discardUpload(ctx, String(upload.id), 'DeleteBucket');
  for (const domain of ctx.rowsRaw(DOMAIN).filter(row => ofBucket(ctx, row._bucket, bucket))) await ctx.remove(DOMAIN, String(domain.id), 'DeleteBucket');
  await ctx.remove(BUCKET, String(bucket.id), 'DeleteBucket');
  return new Response(null, { status: 204 });
}
// source: https://developers.cloudflare.com/r2/api/s3/api/ "the region for an R2 bucket is auto"
export async function GetBucketLocation(ctx: HandlerContext): Promise<Response> {
  return bucketOf(ctx) ? s3.xmlAnswer(s3.doc('LocationConstraint', ['auto'])) : noBucket();
}
// source: spec:/shapes/com.amazonaws.s3#PutBucketCors "configuration for your bucket. If the configuration exists, Amazon S3 replaces"
export async function PutBucketCors(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const xml = await xmlBody(ctx); const rules = s3.parseCors(xml);
  if (!/<CORSConfiguration(?:\s[^>]*)?>/.test(xml) || !rules.length || rules.some(rule => !rule.allowedOrigins.length || !rule.allowedMethods.length
    || rule.allowedMethods.some(method => !['GET', 'PUT', 'POST', 'DELETE', 'HEAD'].includes(method))
    || rule.maxAgeSeconds !== undefined && (typeof rule.maxAgeSeconds === 'number' ? !Number.isInteger(rule.maxAgeSeconds) || rule.maxAgeSeconds < 0 : !/^\d+$/.test(rule.maxAgeSeconds)))) return invalid('Invalid CORS configuration.');
  await ctx.write(BUCKET, String(bucket.id), { cors: rules }, 'PutBucketCors');
  return new Response(null, { status: 200 });
}
// source: spec:/shapes/com.amazonaws.s3#GetBucketCors "Returns the Cross-Origin Resource Sharing"
export async function GetBucketCors(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  if (!Array.isArray(bucket.cors) || !bucket.cors.length) return error('NoSuchCORSConfiguration', 'The CORS configuration does not exist.', 404);
  return s3.xmlAnswer(s3.corsXml(bucket.cors as s3.CorsRule[]));
}
// source: spec:/shapes/com.amazonaws.s3#DeleteBucketCors "configuration information set for the bucket."
export async function DeleteBucketCors(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  await ctx.write(BUCKET, String(bucket.id), { cors: [] }, 'DeleteBucketCors');
  return new Response(null, { status: 204 });
}
// source: spec:/shapes/com.amazonaws.s3#PutBucketLifecycleConfiguration "Creates a new lifecycle configuration for the bucket or replaces an existing lifecycle configuration."
export async function PutBucketLifecycleConfiguration(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const xml = await xmlBody(ctx);
  // The kernel parser exposes prefix/expiry/transition/abort only. Refuse anything it would erase before storing.
  // source: spec:/shapes/com.amazonaws.s3#PutBucketLifecycleConfiguration "Creates a new lifecycle configuration"
  const allowed = new Set(['LifecycleConfiguration', 'Rule', 'ID', 'Status', 'Filter', 'Prefix', 'Expiration', 'Days', 'Date', 'Transition', 'StorageClass', 'AbortIncompleteMultipartUpload', 'DaysAfterInitiation']);
  if ([...xml.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\b/g)].some(match => !allowed.has(match[1]!))) return error('NotImplemented', 'The lifecycle filter or action is not implemented.', 501);
  const rawRules = [...xml.matchAll(/<Rule>([\s\S]*?)<\/Rule>/g)].map(match => match[1]!);
  if (!rawRules.length || rawRules.some(rule => {
    const status = s3.allOf(rule, 'Status');
    const expiration = /<Expiration>([\s\S]*?)<\/Expiration>/.exec(rule)?.[1];
    return status.length !== 1 || !['Enabled', 'Disabled'].includes(status[0]!)
      || s3.allOf(rule, 'Prefix').length > 1
      || !/<(?:Expiration|Transition|AbortIncompleteMultipartUpload)>/.test(rule)
      || expiration !== undefined && (s3.allOf(expiration, 'Days').length + s3.allOf(expiration, 'Date').length !== 1)
      || s3.allOf(rule, 'Days').concat(s3.allOf(rule, 'DaysAfterInitiation')).some(value => !/^[1-9][0-9]*$/.test(value));
  })) return invalid('Invalid lifecycle configuration.');
  const rules = s3.parseLifecycle(xml);
  const positive = (value: number | string | undefined): boolean => value === undefined || typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  const date = (value: string | undefined): boolean => value === undefined || Number.isFinite(Date.parse(value));
  if (!/<LifecycleConfiguration(?:\s[^>]*)?>/.test(xml) || !rules.length
    || rules.some(rule => !positive(rule.expireDays) || !positive(rule.abortMultipartDays) || !date(rule.expireDate)
      || (rule.transitions ?? []).some(transition => !positive(transition.days) || !date(transition.date) || transition.storageClass !== 'STANDARD_IA'))
    || new Set(rules.filter(rule => rule.id).map(rule => rule.id)).size !== rules.filter(rule => rule.id).length) return invalid('Invalid lifecycle configuration.');
  await ctx.write(BUCKET, String(bucket.id), { lifecycle: rules }, 'PutBucketLifecycleConfiguration');
  return new Response(null, { status: 200 });
}
// source: spec:/shapes/com.amazonaws.s3#GetBucketLifecycleConfiguration "Returns the lifecycle configuration information set on the bucket."
export async function GetBucketLifecycleConfiguration(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  if (!Array.isArray(bucket.lifecycle)) return error('NoSuchLifecycleConfiguration', 'The lifecycle configuration does not exist.', 404);
  return s3.xmlAnswer(s3.lifecycleXml(bucket.lifecycle as s3.LifecycleRule[]));
}
// source: spec:/shapes/com.amazonaws.s3#ListObjects "Returns some or all (up to 1,000) of the objects in a bucket."
export async function ListObjects(ctx: HandlerContext): Promise<Response> { return listObjects(ctx, false); }
// source: spec:/shapes/com.amazonaws.s3#ListObjectsV2 "Returns some or all (up to 1,000) of the objects in a bucket with each request."
export async function ListObjectsV2(ctx: HandlerContext): Promise<Response> { return listObjects(ctx, true); }
// source: spec:/shapes/com.amazonaws.s3#PutObject "Adds an object to a bucket."
export async function PutObject(ctx: HandlerContext): Promise<Response> {
  const bucket = await uploadBucket(ctx); if (!bucket) return noBucket();
  const key = String(ctx.call.params.Key ?? ''); if (!keyValid(key)) return error('InvalidObjectName', 'Maximum key length is 1024 bytes.', 400);
  const request = ctx.call.request;
  const encryption = customerEncryption(request); if (encryption instanceof Response) return encryption;
  const precondition = conditions(request, objectOf(ctx, bucket, key)); if (precondition) return precondition;
  const metadataError = metadataRefusal(request); if (metadataError) return metadataError;
  const storage = storageClassOf(request, bucket); if (!storage) return invalid('Invalid storage class.');
  const bytes = await payload(ctx); if (bytes.byteLength > 5 * 1024 ** 3) return error('EntityTooLarge', 'Object is too large.', 400);
  const checks = checksumFields(request, bytes); if (checks.refusal) return checks.refusal;
  const object = await writeObject(ctx, bucket, key, bytes, { _ssec: encryption, _headers: { ...metadataOf(request), ...checks.fields as Record<string, string> }, StorageClass: storage }, 'PutObject');
  return new Response(null, { status: 200, headers: { etag: String(object.ETag), ...encryptionHeaders(encryption), ...checks.fields as Record<string, string> } });
}
// source: spec:/shapes/com.amazonaws.s3#GetObject "Retrieves an object from Amazon S3."
export async function GetObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); return bucket ? readObject(ctx, bucket, String(ctx.call.params.Key ?? ''), ctx.call.request) : noBucket();
}
// source: spec:/shapes/com.amazonaws.s3#HeadObject "operation retrieves metadata from an object without returning the object"
export async function HeadObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); return bucket ? readObject(ctx, bucket, String(ctx.call.params.Key ?? ''), ctx.call.request) : noBucket();
}
// source: spec:/shapes/com.amazonaws.s3#CopyObject "Creates a copy of an object that is already stored in Amazon S3."
export async function CopyObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const key = String(ctx.call.params.Key ?? ''); if (!keyValid(key)) return error('InvalidObjectName', 'Invalid object name.', 400);
  const source = sourceOf(ctx); if (source instanceof Response) return source;
  const request = ctx.call.request;
  const encryption = customerEncryption(request); if (encryption instanceof Response) return encryption;
  const precondition = conditions(request, objectOf(ctx, bucket, key)); if (precondition) return precondition;
  const directive = request.headers.get('x-amz-metadata-directive') ?? 'COPY';
  if (!['COPY', 'REPLACE'].includes(directive)) return invalid('Invalid metadata directive.');
  const metadataError = metadataRefusal(request); if (metadataError) return metadataError;
  const storage = storageClassOf(request, bucket); if (!storage) return invalid('Invalid storage class.');
  const bytes = await ctx.blobs.get(String(source.object._blob)); if (bytes === null) missingObjectBlob();
  // the source's headers are copied whole (its checksums among them); REPLACE takes the request's, with the source's checksums
  const held = (source.object._headers ?? {}) as Record<string, string>;
  const checksums = Object.fromEntries(Object.entries(held).filter(([name]) => name.startsWith('x-amz-checksum-')));
  const object = await writeObject(ctx, bucket, key, bytes, { _ssec: encryption, _headers: directive === 'COPY' ? held : { ...metadataOf(request), ...checksums }, StorageClass: storage }, 'CopyObject');
  return s3.xmlAnswer(s3.doc('CopyObjectResult', [s3.x('ETag', String(object.ETag)), s3.x('LastModified', String(object.LastModified))]), 200, encryptionHeaders(encryption));
}
// source: spec:/shapes/com.amazonaws.s3#DeleteObject "Removes an object from a bucket."
export async function DeleteObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const key = String(ctx.call.params.Key ?? '');
  const refusal = conditions(ctx.call.request, objectOf(ctx, bucket, key)); if (refusal) return refusal;
  const object = objectOf(ctx, bucket, key); if (object) await ctx.remove(OBJECT, String(object.id), 'DeleteObject');
  return new Response(null, { status: 204 });
}
// source: spec:/shapes/com.amazonaws.s3#CreateMultipartUpload "This action initiates a multipart upload and returns an upload ID."
export async function CreateMultipartUpload(ctx: HandlerContext): Promise<Response> {
  const bucket = await uploadBucket(ctx); if (!bucket) return noBucket();
  const key = String(ctx.call.params.Key ?? ''); if (!keyValid(key)) return error('InvalidObjectName', 'Invalid object name.', 400);
  const request = ctx.call.request;
  const encryption = customerEncryption(request); if (encryption instanceof Response) return encryption;
  const metadataError = metadataRefusal(request); if (metadataError) return metadataError;
  const storage = storageClassOf(request, bucket); if (!storage) return invalid('Invalid storage class.');
  // source: https://developers.cloudflare.com/r2/api/s3/api/ "Checksums have an algorithm and a type"
  const algorithm = request.headers.get('x-amz-checksum-algorithm');
  const checksumType = request.headers.get('x-amz-checksum-type') ?? (algorithm === 'CRC64NVME' ? 'FULL_OBJECT' : 'COMPOSITE');
  if (algorithm && !CHECKSUMS.includes(algorithm as typeof CHECKSUMS[number])) return invalid('Invalid checksum algorithm.');
  if (algorithm && checksumType !== (algorithm === 'CRC64NVME' ? 'FULL_OBJECT' : 'COMPOSITE')) return error('NotImplemented', 'The checksum type is not implemented for this algorithm.', 501);
  const id = ctx.mint('Multipart');
  await ctx.write(UPLOAD, id, { UploadId: id, _bucket: bucket.id, Key: key, Initiated: ctx.occurredAt,
    _ssec: encryption, _checksumAlgorithm: algorithm, _checksumType: algorithm ? checksumType : null, _headers: metadataOf(request), StorageClass: storage, deleted: false }, 'CreateMultipartUpload');
  return s3.xmlAnswer(s3.doc('InitiateMultipartUploadResult', [s3.x('Bucket', String(bucket.name)), s3.x('Key', key), s3.x('UploadId', id)]), 200, encryptionHeaders(encryption));
}
// source: spec:/shapes/com.amazonaws.s3#UploadPart "Uploads a part in a multipart upload."
export async function UploadPart(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const key = String(ctx.call.params.Key ?? ''); const upload = uploadOf(ctx, bucket, key, new URL(ctx.call.request.url).searchParams.get('uploadId') ?? '');
  if (!upload) return noUpload();
  const encryption = heldEncryption(ctx.call.request, upload._ssec as Row | null | undefined); if (encryption instanceof Response) return encryption;
  const number = Number(new URL(ctx.call.request.url).searchParams.get('partNumber'));
  // source: https://developers.cloudflare.com/r2/api/s3/api/ "the original part is lost"
  const prior = ctx.row(PART, `${upload.id}:${number}`);
  if (prior) await ctx.remove(PART, String(prior.id), 'UploadPart');
  const bytes = await payload(ctx); const checks = checksumFields(ctx.call.request, bytes); if (checks.refusal) return checks.refusal;
  const algorithm = upload._checksumAlgorithm as s3.ChecksumAlgorithm | null;
  if (algorithm) checks.fields[`x-amz-checksum-${algorithm.toLowerCase()}`] = s3.checksum(algorithm, bytes);
  const result = await putPart(ctx, upload, number, bytes, checks.fields, 'UploadPart');
  if (result instanceof Response) return result;
  return new Response(null, { status: 200, headers: { etag: String(result.ETag), ...encryptionHeaders(encryption), ...result.checksums as Record<string, string> } });
}
// source: spec:/shapes/com.amazonaws.s3#ListMultipartUploads "This operation lists in-progress multipart uploads in a bucket."
export async function ListMultipartUploads(ctx: HandlerContext): Promise<Response> { return listUploads(ctx); }
// source: spec:/shapes/com.amazonaws.s3#ListParts "Lists the parts that have been uploaded for a specific multipart upload."
export async function ListParts(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const query = new URL(ctx.call.request.url).searchParams; const key = String(ctx.call.params.Key ?? '');
  const upload = uploadOf(ctx, bucket, key, query.get('uploadId') ?? ''); if (!upload) return noUpload();
  const marker = Number(query.get('part-number-marker') ?? 0); const asked = Number(query.get('max-parts') ?? 1000);
  if (!Number.isInteger(marker) || marker < 0 || !Number.isInteger(asked) || asked < 0) return invalid('Invalid part pagination.');
  const limit = Math.min(1000, asked); const all = partsOf(ctx, String(upload.id)).filter(part => Number(part.PartNumber) > marker);
  const page = all.slice(0, limit); const truncated = limit > 0 && all.length > limit;
  // source: spec:/shapes/com.amazonaws.s3#ListPartsOutput "Container element that identifies who initiated the multipart upload."
  return s3.xmlAnswer(s3.doc('ListPartsResult', [s3.x('Bucket', String(bucket.name)), s3.x('Key', key), s3.x('UploadId', String(upload.UploadId)),
    ownerXml(String(bucket.account_id), 'Initiator'), ownerXml(String(bucket.account_id)),
    s3.x('PartNumberMarker', marker), s3.x('NextPartNumberMarker', truncated ? Number(page.at(-1)!.PartNumber) : 0),
    s3.x('MaxParts', limit), s3.x('IsTruncated', String(truncated)), s3.x('StorageClass', String(upload.StorageClass)),
    ...page.map(part => s3.x('Part', [s3.x('PartNumber', Number(part.PartNumber)), s3.x('LastModified', String(part.LastModified)),
      s3.x('ETag', String(part.ETag)), s3.x('Size', Number(part.Size)),
      ...Object.entries((part.checksums ?? {}) as Row).map(([name, value]) => s3.x(`Checksum${name.slice('x-amz-checksum-'.length).toUpperCase()}`, String(value)))]))]));
}
// source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUpload "Completes a multipart upload by assembling previously uploaded parts."
export async function CompleteMultipartUpload(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const key = String(ctx.call.params.Key ?? ''); const upload = uploadOf(ctx, bucket, key, new URL(ctx.call.request.url).searchParams.get('uploadId') ?? '');
  if (!upload) return noUpload();
  // the key completes only an upload created with a checksum algorithm; for any other it may be left out, and is checked when sent
  // source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUploadRequest/members/SSECustomerKey "This parameter is needed only when the object was created using a checksum algorithm."
  const refusal = heldEncryption(ctx.call.request, upload._ssec as Row | null | undefined, { optional: !upload._checksumAlgorithm }); if (refusal instanceof Response) return refusal;
  const xml = await xmlBody(ctx); const requested = [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(match => ({
    number: Number(s3.oneOf(match[1]!, 'PartNumber')), etag: s3.oneOf(match[1]!, 'ETag'),
  }));
  if (!/<CompleteMultipartUpload(?:\s[^>]*)?>/.test(xml) || !requested.length) return error('MalformedXML', 'Invalid multipart completion XML.', 400);
  if (requested.some((part, index) => !Number.isInteger(part.number) || part.number < 1 || part.number > 10000 || index > 0 && part.number <= requested[index - 1]!.number)) return error('InvalidPartOrder', 'Parts must be in ascending order.', 400);
  const held = partsOf(ctx, String(upload.id)); const chosen: Row[] = [];
  for (const part of requested) {
    const stored = held.find(row => row.PartNumber === part.number);
    // a part a vendor-backed refresh observed holds no bytes (`_blob`): not uploaded here, it completes nothing until it is (the README)
    // source: https://developers.cloudflare.com/r2/api/error-codes/ "One or more parts could not be found when completing the upload."
    if (!stored || stored.ETag !== part.etag || !stored._blob) return error('InvalidPart', 'One or more parts could not be found when completing the upload.', 400);
    chosen.push(stored);
  }
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Multipart part is below minimum size (5 MiB), except for the last part."
  if (chosen.slice(0, -1).some(part => Number(part.Size) < 5 * 1024 ** 2)) return error('EntityTooSmall', 'Non-final parts must be at least 5 MiB.', 400);
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "All non-trailing parts must have the same size."
  if (chosen.slice(0, -1).some(part => part.Size !== chosen[0]!.Size)) return error('InvalidPart', 'All non-trailing parts must have the same size.', 400);
  const buffers: Uint8Array[] = [];
  for (const part of chosen) { const bytes = await ctx.blobs.get(String(part._blob)); if (bytes === null) missingObjectBlob(); buffers.push(bytes); }
  const bytes = s3.concatBytes(buffers);
  if (bytes.byteLength > 5 * 1024 ** 4) return error('EntityTooLarge', 'Multipart object is too large.', 400);
  // source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUploadRequest/members/ChecksumType "determines how part-level checksums are"
  const algorithm = upload._checksumAlgorithm as s3.ChecksumAlgorithm | null;
  const checksumHeaders: Record<string, string> = {};
  // source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUploadRequest/members/ChecksumType "BadDigest"
  const requestedType = ctx.call.request.headers.get('x-amz-checksum-type');
  // R2's BadDigest row names the checksum the request supplies; a checksum type other than the upload's is answered with it
  // (the documentation stops at the row's text)
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Provided checksum does not match the uploaded content."
  if (requestedType !== null && requestedType !== upload._checksumType) return error('BadDigest', 'Provided checksum does not match the uploaded content.', 400);
  if (algorithm) {
    const name = `x-amz-checksum-${algorithm.toLowerCase()}`;
    const digest = upload._checksumType === 'FULL_OBJECT' ? s3.checksum(algorithm, bytes)
      : `${s3.checksum(algorithm, s3.concatBytes(chosen.map(part => new Uint8Array(Buffer.from(String((part.checksums as Row)[name]), 'base64')))))}-${chosen.length}`;
    const supplied = ctx.call.request.headers.get(name);
    // a value that is no base64 digest of the algorithm's length (a composite one followed by -<parts>) is malformed, not a mismatch
    // R2's page does not say how it reads unpadded base64 of the right length, or a part count present on a full-object
    // checksum or absent from a composite one: the documentation stops there, and those values are compared as given
    // source: https://developers.cloudflare.com/r2/api/error-codes/ "Checksum header format is malformed."
    const bare = supplied?.replace(/-\d+$/, '') ?? '';
    if (supplied !== null && (!/^[A-Za-z0-9+/]+={0,2}$/.test(bare) || Buffer.from(bare, 'base64').byteLength !== Buffer.from(digest.replace(/-\d+$/, ''), 'base64').byteLength)) return error('InvalidDigest', 'Checksum header format is malformed.', 400);
    // source: https://developers.cloudflare.com/r2/api/error-codes/ "Provided checksum does not match the uploaded content."
    if (supplied !== null && supplied !== digest) return error('BadDigest', 'Provided checksum does not match the uploaded content.', 400);
    checksumHeaders[name] = digest; checksumHeaders['x-amz-checksum-type'] = String(upload._checksumType);
  }
  const etagBytes = s3.concatBytes(chosen.map(part => new Uint8Array(Buffer.from(String(part.ETag).replace(/"/g, ''), 'hex'))));
  const etag = `"${ctx.crypto.md5(etagBytes)}-${chosen.length}"`;
  const object = await writeObject(ctx, bucket, key, bytes, { _ssec: upload._ssec ?? null, _partSizes: chosen.map(part => Number(part.Size)), _headers: { ...(upload._headers ?? {}) as Record<string, string>, ...checksumHeaders }, StorageClass: upload.StorageClass }, 'CompleteMultipartUpload', etag);
  await discardUpload(ctx, String(upload.id), 'CompleteMultipartUpload');
  // the object's URI on the account's S3 endpoint, where R2 serves it; the answer names no customer key (the output
  // shape has none of SSE-C's members)
  // source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUploadOutput "The URI that identifies the newly created object."
  const location = `https://${String(bucket.account_id)}.r2.cloudflarestorage.com/${String(bucket.name)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return s3.xmlAnswer(s3.doc('CompleteMultipartUploadResult', [s3.x('Location', location), s3.x('Bucket', String(bucket.name)), s3.x('Key', key), s3.x('ETag', String(object.ETag)), ...Object.entries(checksumHeaders).map(([name, value]) => s3.x(name === 'x-amz-checksum-type' ? 'ChecksumType' : `Checksum${name.slice('x-amz-checksum-'.length).toUpperCase()}`, value))]));
}
// source: spec:/shapes/com.amazonaws.s3#AbortMultipartUpload "This operation aborts a multipart upload."
export async function AbortMultipartUpload(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const upload = uploadOf(ctx, bucket, String(ctx.call.params.Key ?? ''), new URL(ctx.call.request.url).searchParams.get('uploadId') ?? '');
  if (!upload) return noUpload();
  await discardUpload(ctx, String(upload.id), 'AbortMultipartUpload'); return new Response(null, { status: 204 });
}
