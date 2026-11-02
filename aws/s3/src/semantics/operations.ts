// Amazon S3's buckets and objects, the operations the applications make (../../../journeys/demand.json and
// ../../../journeys/decisions.json): a bucket made, found, listed and opened to a browser's uploads (its CORS); an object
// put, read (presigned too, its response headers overridden, a byte range), found, copied, deleted, deleted in a batch and
// listed; a large object uploaded in parts, and the in-progress uploads and their parts listed, as a vendor-backed World
// reads them back. Over S3's wire (world-core's `s3`); what they share is ./shared.ts.
import { s3, type HandlerContext } from '@volter/world-core';
import {
  BUCKET, MIN_PART, OBJECT, UPLOAD, bucketName, bucketOf, canonicalId, closeUpload, heldBytes, integrity, invalidArgument, keepPart, keyName,
  lexical, malformedXml, metadataOf, noSuchBucket, noSuchKey, noSuchUpload, objectHeaders, objectOf, objectsIn, ownerXml,
  partNumber, partsOf, query, rangeOf, refuse, signerArn, unserved, uploadOf, worldAccountOf, writeObject, type Row,
} from './shared.ts';

const { allOf, bytesOf, doc, oneOf, parseCors, parseDelete, x, xmlAnswer } = s3;

/** `PUT /{Bucket}`: a bucket, in the Region its configuration names (us-east-1 when it names none). S3's names are 3 to 63
 *  lowercase letters, digits, dots and hyphens; a name the account already holds is answered as S3 answers it in
 *  us-east-1 (success). */
// source: spec:/shapes/com.amazonaws.s3#CreateBucket "This action creates an Amazon S3 bucket"
export async function CreateBucket(ctx: HandlerContext): Promise<Response> {
  const name = bucketName(ctx);
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The specified bucket is not valid."
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) || name.includes('..')) return refuse(400, 'InvalidBucketName', 'The specified bucket is not valid.');
  // source: spec:/shapes/com.amazonaws.s3#CreateBucketConfiguration "Specifies the Region where the bucket will be created."
  const asked = oneOf(new TextDecoder().decode(bytesOf(ctx.call.request)), 'LocationConstraint');
  // where the documentation stops: the legacy `EU` constraint (API_CreateBucket.html's "Setting the Region of a bucket")
  // is the Region eu-west-1
  const region = asked === 'EU' ? 'eu-west-1' : asked || 'us-east-1';
  const account = worldAccountOf(ctx);
  // A bucket name is global, even though its objects and multipart work are private to the account.
  await ctx.createUnique(BUCKET, { Name: name, CreationDate: ctx.occurredAt, BucketRegion: region, _world_account: account }, 'CreateBucket', { id: name });
  const held = ctx.row(BUCKET, name)!;
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The requested bucket name is not available."
  if ((held._world_account ?? 'default') !== account) return refuse(409, 'BucketAlreadyExists', 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.');
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "if you re-create an existing bucket that you already own in the North Virginia Region, Amazon S3 returns 200 OK"
  // where the documentation stops: a bucket outside us-east-1 is located by its virtual-hosted address
  return ctx.raw(null, { headers: { location: region === 'us-east-1' ? `/${name}` : `http://${name}.s3.amazonaws.com/` } });
}

// source: spec:/shapes/com.amazonaws.s3#HeadBucket "You can use this operation to determine if a bucket exists and if you have permission to access it"
export async function HeadBucket(ctx: HandlerContext): Promise<Response> {
  const b = bucketOf(ctx, bucketName(ctx));
  return b ? ctx.raw(null, { headers: { 'x-amz-bucket-region': String(b.BucketRegion ?? 'us-east-1') } }) : ctx.raw(null, { status: 404 });
}

/** `GET /`: the account's buckets by name, under `prefix`, `max-buckets` at a time after the continuation token. */
// source: spec:/shapes/com.amazonaws.s3#ListBuckets "Returns a list of all buckets owned by the authenticated sender of the request."
export async function ListBuckets(ctx: HandlerContext): Promise<Response> {
  const q = query(ctx);
  const prefix = q.get('prefix') ?? '';
  const region = q.get('bucket-region');
  const max = Math.min(10_000, Math.max(1, Number(q.get('max-buckets') ?? 10_000) || 10_000));
  const token = q.get('continuation-token');
  let after = '';
  if (token) { try { after = atob(token); } catch { return invalidArgument('The continuation token provided is incorrect'); } }
  const account = worldAccountOf(ctx);
  const all = ctx.rowsRaw(BUCKET).filter((b) => (b._world_account ?? 'default') === account && b.deleted !== true && String(b.Name).startsWith(prefix) && lexical(String(b.Name), after) > 0 && (!region || b.BucketRegion === region))
    .sort((a, b) => lexical(String(a.Name), String(b.Name)));
  const page = all.slice(0, max);
  const truncated = all.length > page.length;
  return xmlAnswer(doc('ListAllMyBucketsResult', [
    x('Buckets', page.map((b) => x('Bucket', [x('Name', String(b.Name)), x('CreationDate', String(b.CreationDate)), x('BucketRegion', String(b.BucketRegion ?? 'us-east-1'))]))),
    ownerXml(await canonicalId(ctx)),
    ...(truncated ? [x('ContinuationToken', btoa(String(page.at(-1)!.Name)))] : []),
    ...(q.has('prefix') ? [x('Prefix', prefix)] : []),
  ]));
}

/** `PUT /{Bucket}?cors`: the bucket's CORS rules, replacing any it had; a browser's preflight is answered by them
 *  (./around.ts). */
// source: spec:/shapes/com.amazonaws.s3#PutBucketCors "configuration for your bucket. If the configuration exists, Amazon S3 replaces"
export async function PutBucketCors(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx, bucketName(ctx));
  if (!bucket) return noSuchBucket();
  const bytes = bytesOf(ctx.call.request);
  const checked = integrity(ctx.call.request, bytes);
  if (checked instanceof Response) return checked;
  const xml = new TextDecoder().decode(bytes);
  const rules = parseCors(xml);
  if (!/<CORSConfiguration(?:\s[^>]*)?>/.test(xml) || !rules.length || rules.some((r) => !r.allowedOrigins.length || !r.allowedMethods.length)) return malformedXml();
  await ctx.write(BUCKET, String(bucket.id), { _cors: rules }, 'PutBucketCors');
  return ctx.raw(null);
}

/** `PUT /{Bucket}/{Key}`: an object, its bytes and the headers it keeps; its ETag (and the checksums the client sent, and
 *  its encryption) answered. */
// source: spec:/shapes/com.amazonaws.s3#PutObject "Adds an object to a bucket"
export async function PutObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  const key = keyName(ctx);
  const request = ctx.call.request;
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const refused = unserved(request);
  if (refused) return refused;
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "Your key is too long."
  if (new TextEncoder().encode(key).length > 1024) return refuse(400, 'KeyTooLongError', 'Your key is too long');
  const bytes = bytesOf(request);
  const checked = integrity(request, bytes);
  if (checked instanceof Response) return checked;
  const kept = { ...metadataOf(request), ...checked.checksums };
  const object = await writeObject(ctx, bucket, key, bytes, { _headers: kept, StorageClass: request.headers.get('x-amz-storage-class') ?? 'STANDARD' }, 'PutObject');
  return ctx.raw(null, { headers: { etag: String(object.ETag), 'x-amz-server-side-encryption': kept['x-amz-server-side-encryption']!, ...checked.checksums } });
}

// source: spec:/shapes/com.amazonaws.s3#GetObject "Retrieves an object from Amazon S3"
export async function GetObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const o = objectOf(ctx, bucket, keyName(ctx));
  if (!o) return noSuchKey();
  const headers = objectHeaders(o, ctx.call.request);
  const range = rangeOf(ctx.call.request.headers.get('range'), Number(o.Size));
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The requested range cannot be satisfied."
  if (range === false) return refuse(416, 'InvalidRange', 'The requested range is not satisfiable');
  const bytes = await heldBytes(ctx, o);
  if (!range) return ctx.raw(bytes.slice(), { headers });
  return ctx.raw(bytes.slice(range.start, range.end + 1), { status: 206, headers: { ...headers, 'content-length': String(range.end - range.start + 1), 'content-range': `bytes ${range.start}-${range.end}/${bytes.length}` } });
}

// source: spec:/shapes/com.amazonaws.s3#HeadObject "operation retrieves metadata from an object without returning the object itself"
export async function HeadObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  const o = bucketOf(ctx, bucket) ? objectOf(ctx, bucket, keyName(ctx)) : undefined;
  return o ? ctx.raw(null, { headers: objectHeaders(o, ctx.call.request) }) : ctx.raw(null, { status: 404 });
}

/** `DELETE /{Bucket}/{Key}`: the object gone; deleting a key the bucket does not hold answers the same. */
// source: spec:/shapes/com.amazonaws.s3#DeleteObject "Removes an object from a bucket"
export async function DeleteObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const o = objectOf(ctx, bucket, keyName(ctx));
  if (o) await ctx.remove(OBJECT, String(o.id), 'DeleteObject');
  return ctx.raw(null, { status: 204 });
}

// source: spec:/shapes/com.amazonaws.s3#DeleteObjects "This operation enables you to delete multiple objects from a bucket using a single HTTP request"
export async function DeleteObjects(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const bytes = bytesOf(ctx.call.request);
  const checked = integrity(ctx.call.request, bytes);
  if (checked instanceof Response) return checked;
  const { keys, quiet } = parseDelete(new TextDecoder().decode(bytes));
  for (const key of keys) {
    const o = objectOf(ctx, bucket, key);
    if (o) await ctx.remove(OBJECT, String(o.id), 'DeleteObjects');
  }
  return xmlAnswer(doc('DeleteResult', quiet ? [] : keys.map((k) => x('Deleted', [x('Key', k)]))));
}

/** `PUT /{Bucket}/{Key}` with `x-amz-copy-source: /<bucket>/<key>`: the object copied, its headers with it unless the
 *  request replaces them. */
// source: spec:/shapes/com.amazonaws.s3#CopyObject "Creates a copy of an object that is already stored in Amazon S3"
export async function CopyObject(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  const request = ctx.call.request;
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const refused = unserved(request);
  if (refused) return refused;
  const source = decodeURIComponent(request.headers.get('x-amz-copy-source') ?? '').replace(/^\//, '').split('?')[0]!;
  const at = source.indexOf('/');
  const from = at > 0 ? objectOf(ctx, source.slice(0, at), source.slice(at + 1)) : undefined;
  if (!from) return noSuchKey();
  const bytes = await heldBytes(ctx, from);
  // source: spec:/shapes/com.amazonaws.s3#CopyObjectRequest "Specifies whether the metadata is copied from the source object or replaced with metadata that's provided in the request."
  const held = (from._headers ?? {}) as Record<string, string>;
  const kept = request.headers.get('x-amz-metadata-directive') === 'REPLACE'
    ? { ...metadataOf(request), ...Object.fromEntries(Object.entries(held).filter(([h]) => h.startsWith('x-amz-checksum-'))) }
    : held;
  const object = await writeObject(ctx, bucket, keyName(ctx), bytes, { _headers: kept, StorageClass: request.headers.get('x-amz-storage-class') ?? 'STANDARD', ETag: String(from.ETag) }, 'CopyObject');
  return xmlAnswer(doc('CopyObjectResult', [x('LastModified', String(object.LastModified)), x('ETag', String(object.ETag))]), 200, { 'x-amz-server-side-encryption': kept['x-amz-server-side-encryption'] ?? 'AES256' });
}

/** `GET /{Bucket}?list-type=2`: keys under `prefix`, after `start-after` or the continuation token, rolled up at the
 *  `delimiter` into common prefixes, `max-keys` at a time (1,000 by default). */
// source: spec:/shapes/com.amazonaws.s3#ListObjectsV2 "Returns some or all (up to 1,000) of the objects in a bucket with each request"
export async function ListObjectsV2(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const q = query(ctx);
  const prefix = q.get('prefix') ?? '';
  const delimiter = q.get('delimiter') ?? '';
  const max = Math.min(1000, Math.max(0, Number(q.get('max-keys') ?? 1000) || 0));
  const token = q.get('continuation-token');
  let after = q.get('start-after') ?? '';
  if (token) { try { after = atob(token); } catch { return invalidArgument('The continuation token provided is incorrect'); } }
  const entries: Array<{ key: string; prefix?: string; o?: Row }> = [];
  const seen = new Set<string>();
  for (const o of objectsIn(ctx, bucket)) {
    const key = String(o.Key);
    if (!key.startsWith(prefix) || lexical(key, after) <= 0) continue;
    if (delimiter) {
      const at = key.indexOf(delimiter, prefix.length);
      if (at >= 0) { const p = key.slice(0, at + delimiter.length); if (!seen.has(p)) { seen.add(p); entries.push({ key, prefix: p }); } continue; }
    }
    entries.push({ key, o });
  }
  const page = entries.slice(0, max);
  const truncated = entries.length > page.length;
  const last = page.at(-1)?.key ?? '';
  return xmlAnswer(doc('ListBucketResult', [
    x('Name', bucket), x('Prefix', prefix), ...(delimiter ? [x('Delimiter', delimiter)] : []), x('MaxKeys', max), x('KeyCount', page.length), x('IsTruncated', String(truncated)),
    ...(token ? [x('ContinuationToken', token)] : []), ...(truncated ? [x('NextContinuationToken', btoa(last))] : []), ...(q.get('start-after') ? [x('StartAfter', String(q.get('start-after')))] : []),
    ...page.filter((e) => e.o).map((e) => x('Contents', [x('Key', e.key), x('LastModified', String(e.o!.LastModified)), x('ETag', String(e.o!.ETag)), x('Size', Number(e.o!.Size)), x('StorageClass', String(e.o!.StorageClass ?? 'STANDARD'))])),
    ...page.filter((e) => e.prefix).map((e) => x('CommonPrefixes', [x('Prefix', e.prefix!)])),
  ]));
}

/** `POST /{Bucket}/{Key}?uploads`: an upload begun, its id answered (InitiateMultipartUploadResult). Where the
 *  documentation stops: the id's form, drawn from a secret the World holds (ctx.secret). */
// source: spec:/shapes/com.amazonaws.s3#CreateMultipartUpload "This action initiates a multipart upload and returns an upload ID."
export async function CreateMultipartUpload(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  const key = keyName(ctx);
  const request = ctx.call.request;
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const refused = unserved(request);
  if (refused) return refused;
  const n = await ctx.issue('_seq_upload');
  const uploadId = (await ctx.secret(`s3-upload:${bucket}/${key}:${n}`)).replace(/[^A-Za-z0-9]/g, '');
  const owner = { ID: await canonicalId(ctx) };
  // the principal that signed the request: an IAM user's ARN, or for the account's own (root) credentials its canonical user ID
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Initiator.html "If the principal is an IAM User, it provides a user ARN value."
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Initiator.html "If the principal is an AWS account, it provides the Canonical User ID."
  const initiator = { ID: signerArn(ctx, request) ?? owner.ID };
  await ctx.write(UPLOAD, uploadId, {
    UploadId: uploadId, Key: key, Initiated: ctx.occurredAt, StorageClass: request.headers.get('x-amz-storage-class') ?? 'STANDARD', Owner: owner, Initiator: initiator,
    _bucket: bucket, _headers: metadataOf(request), deleted: false,
  }, 'CreateMultipartUpload');
  return xmlAnswer(doc('InitiateMultipartUploadResult', [x('Bucket', bucket), x('Key', key), x('UploadId', uploadId)]));
}

/** `PUT /{Bucket}/{Key}?partNumber=N&uploadId=X`: a part's bytes, its ETag answered (a part sent again replaces it). */
// source: spec:/shapes/com.amazonaws.s3#UploadPart "Uploads a part in a multipart upload."
export async function UploadPart(ctx: HandlerContext): Promise<Response> {
  if (!bucketOf(ctx, bucketName(ctx))) return noSuchBucket();
  const upload = uploadOf(ctx);
  if (!upload) return noSuchUpload();
  const n = partNumber(ctx);
  if (typeof n !== 'number') return n;
  const refused = unserved(ctx.call.request);
  if (refused) return refused;
  const bytes = bytesOf(ctx.call.request);
  const checked = integrity(ctx.call.request, bytes);
  if (checked instanceof Response) return checked;
  const part = await keepPart(ctx, upload, n, bytes, checked.checksums);
  return ctx.raw(null, { headers: { etag: String(part.ETag), 'x-amz-server-side-encryption': String(((upload._headers ?? {}) as Row)['x-amz-server-side-encryption'] ?? 'AES256'), ...checked.checksums } });
}

/** `POST /{Bucket}/{Key}?uploadId=X` with the parts to join: the object, made of the named parts in ascending order,
 *  each but the last at least 5 MiB, each ETag the one its upload answered; its ETag the MD5 of the parts' MD5s and
 *  their count (the form S3 answers for a multipart object). */
// source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUpload "Completes a multipart upload by assembling previously uploaded parts."
export async function CompleteMultipartUpload(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  const key = keyName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const upload = uploadOf(ctx);
  if (!upload) return noSuchUpload();
  const body = new TextDecoder().decode(bytesOf(ctx.call.request));
  const named = allOf(body, 'Part').map((p) => ({ n: Number(oneOf(p, 'PartNumber')), etag: String(oneOf(p, 'ETag') ?? '').replace(/&quot;/g, '"') }));
  if (named.length === 0) return malformedXml();
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The list of parts was not in ascending order. Parts list must be specified in order by part number."
  if (named.some((p, i) => i > 0 && p.n <= named[i - 1]!.n)) return refuse(400, 'InvalidPartOrder', 'The list of parts was not in ascending order. Parts list must be specified in order by part number.');
  const held = new Map(partsOf(ctx, String(upload.id)).map((p) => [Number(p.PartNumber), p]));
  const chosen: Row[] = [];
  for (const p of named) {
    const part = held.get(p.n);
    const quoted = p.etag.startsWith('"') ? p.etag : `"${p.etag}"`;
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html "One or more of the specified parts could not be found. The part might not have been uploaded, or the specified ETag might not have matched the uploaded part's ETag."
    if (!part || part.ETag !== quoted) return refuse(400, 'InvalidPart', "One or more of the specified parts could not be found. The part might not have been uploaded, or the specified ETag might not have matched the uploaded part's ETag.");
    chosen.push(part);
  }
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html "Your proposed upload is smaller than the minimum allowed object size. Each part must be at least 5 MB in size, except the last part."
  if (chosen.slice(0, -1).some((p) => Number(p.Size) < MIN_PART)) return refuse(400, 'EntityTooSmall', 'Your proposed upload is smaller than the minimum allowed object size.');
  const pieces: Uint8Array[] = [];
  for (const p of chosen) pieces.push(await heldBytes(ctx, p));
  const digests = s3.concatBytes(chosen.map((p) => new Uint8Array(Buffer.from(String(p.ETag).replace(/"/g, ''), 'hex'))));
  const etag = `"${ctx.crypto.md5(digests)}-${chosen.length}"`;
  await writeObject(ctx, bucket, key, s3.concatBytes(pieces), { _headers: (upload._headers ?? {}) as Record<string, string>, StorageClass: String(upload.StorageClass ?? 'STANDARD'), ETag: etag }, 'CompleteMultipartUpload');
  await closeUpload(ctx, upload, 'CompleteMultipartUpload');
  // source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUploadOutput "The URI that identifies the newly created object."
  // the bucket's virtual-hosted address in its Region and the key, as the published example answers it
  // source: spec:/shapes/com.amazonaws.s3#CompleteMultipartUpload/traits/smithy.api#examples/0/output/Location "https://examplebucket.s3.<Region>.amazonaws.com/bigobject"
  const region = String(bucketOf(ctx, bucket)!.BucketRegion ?? 'us-east-1');
  const location = `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
  return xmlAnswer(doc('CompleteMultipartUploadResult', [x('Location', location), x('Bucket', bucket), x('Key', key), x('ETag', etag)]));
}

/** `DELETE /{Bucket}/{Key}?uploadId=X`: the upload aborted, its parts gone (204). */
// source: spec:/shapes/com.amazonaws.s3#AbortMultipartUpload "This operation aborts a multipart upload."
export async function AbortMultipartUpload(ctx: HandlerContext): Promise<Response> {
  if (!bucketOf(ctx, bucketName(ctx))) return noSuchBucket();
  const upload = uploadOf(ctx);
  if (!upload) return noSuchUpload();
  await closeUpload(ctx, upload, 'AbortMultipartUpload');
  return ctx.raw(null, { status: 204 });
}

/** `GET /{Bucket}?uploads`: the bucket's in-progress uploads by key, then by when each began, after the key and upload id
 *  markers, under `prefix`, rolled up at the `delimiter`, `max-uploads` at a time (1,000 by default). */
// source: spec:/shapes/com.amazonaws.s3#ListMultipartUploads "This operation lists in-progress multipart uploads in a bucket."
export async function ListMultipartUploads(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const q = query(ctx);
  const prefix = q.get('prefix') ?? '';
  const delimiter = q.get('delimiter') ?? '';
  const keyMarker = q.get('key-marker') ?? '';
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html "If key-marker is not specified, the upload-id-marker parameter is ignored."
  const uploadMarker = keyMarker ? q.get('upload-id-marker') ?? '' : '';
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html "Sets the maximum number of multipart uploads, from 1 to 1,000, to return in the response body."
  const max = Math.min(1000, Math.max(0, Number(q.get('max-uploads') ?? 1000) || 0));
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html "For uploads that share the same object key, they are further sorted in ascending order based on the upload initiation time."
  const uploads = ctx.rowsRaw(UPLOAD).filter((u) => u._bucket === bucket && u.deleted !== true && String(u.Key).startsWith(prefix))
    .sort((a, b) => lexical(String(a.Key), String(b.Key)) || String(a.Initiated).localeCompare(String(b.Initiated)));
  const entries: Array<{ key: string; id: string; u?: Row }> = [];
  const seen = new Set<string>();
  for (const u of uploads) {
    const key = String(u.Key);
    const id = String(u.UploadId);
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListMultipartUploads.html "any multipart uploads for a key equal to the key-marker might also be included, provided those multipart uploads have upload IDs lexicographically greater than the specified upload-id-marker ."
    if (keyMarker && !(lexical(key, keyMarker) > 0 || (key === keyMarker && uploadMarker && lexical(id, uploadMarker) > 0))) continue;
    const at = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
    if (at >= 0) { const p = key.slice(0, at + delimiter.length); if (!seen.has(p)) { seen.add(p); entries.push({ key: p, id: '' }); } continue; }
    entries.push({ key, id, u });
  }
  const page = entries.slice(0, max);
  const truncated = entries.length > page.length;
  const last = page.at(-1);
  return xmlAnswer(doc('ListMultipartUploadsResult', [
    x('Bucket', bucket), x('KeyMarker', keyMarker), x('UploadIdMarker', uploadMarker),
    ...(truncated && last ? [x('NextKeyMarker', last.key), x('NextUploadIdMarker', last.id)] : []),
    ...(q.has('prefix') ? [x('Prefix', prefix)] : []), ...(delimiter ? [x('Delimiter', delimiter)] : []),
    x('MaxUploads', max), x('IsTruncated', String(truncated)),
    ...page.filter((e) => e.u).map((e) => x('Upload', [x('Key', e.key), x('UploadId', e.id),
      ownerXml(String((e.u!.Initiator as Row | undefined)?.ID ?? ''), 'Initiator'), ownerXml(String((e.u!.Owner as Row | undefined)?.ID ?? '')),
      x('StorageClass', String(e.u!.StorageClass ?? 'STANDARD')), x('Initiated', String(e.u!.Initiated))])),
    ...page.filter((e) => !e.u).map((e) => x('CommonPrefixes', [x('Prefix', e.key)])),
  ]));
}

/** `GET /{Bucket}/{Key}?uploadId=X`: an upload's parts by number, after `part-number-marker`, `max-parts` at a time (1,000
 *  by default). */
// source: spec:/shapes/com.amazonaws.s3#ListParts "Lists the parts that have been uploaded for a specific multipart upload."
export async function ListParts(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketName(ctx);
  if (!bucketOf(ctx, bucket)) return noSuchBucket();
  const upload = uploadOf(ctx);
  if (!upload) return noSuchUpload();
  const q = query(ctx);
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListParts.html "Specifies the part after which listing should begin. Only parts with higher part numbers will be listed."
  const marker = Number(q.get('part-number-marker') ?? 0) || 0;
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListParts.html "The ListParts request returns a maximum of 1,000 uploaded parts. The limit of 1,000 parts is also the default value."
  const max = Math.min(1000, Math.max(0, Number(q.get('max-parts') ?? 1000) || 0));
  const all = partsOf(ctx, String(upload.id)).filter((p) => Number(p.PartNumber) > marker);
  const page = all.slice(0, max);
  const truncated = all.length > page.length;
  const checksums = (p: Row): string[] => Object.entries(p).filter(([k]) => /^Checksum[A-Z0-9]+$/.test(k)).map(([k, v]) => x(k, String(v)));
  return xmlAnswer(doc('ListPartsResult', [
    x('Bucket', bucket), x('Key', String(upload.Key)), x('UploadId', String(upload.UploadId)),
    x('PartNumberMarker', marker), ...(page.length ? [x('NextPartNumberMarker', Number(page.at(-1)!.PartNumber))] : []), x('MaxParts', max), x('IsTruncated', String(truncated)),
    ...page.map((p) => x('Part', [x('PartNumber', Number(p.PartNumber)), x('LastModified', String(p.LastModified)), x('ETag', String(p.ETag)), x('Size', Number(p.Size)), ...checksums(p)])),
    ownerXml(String((upload.Initiator as Row | undefined)?.ID ?? ''), 'Initiator'), ownerXml(String((upload.Owner as Row | undefined)?.ID ?? '')),
    x('StorageClass', String(upload.StorageClass ?? 'STANDARD')),
  ]));
}
