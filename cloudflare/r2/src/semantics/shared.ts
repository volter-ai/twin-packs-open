// R2's wire helpers, freshly authored from the S3 model and Cloudflare references for c4.
import { s3, type HandlerContext } from '@volter/world-core';
import { ofBucket, bucketNamed, bucketAccount, API_TOKEN, OBJECT, UPLOAD, PART, DOMAIN, TEMPORARY, bucketNameValid, objectKey, putBucket, r2Grant, type Row } from '../../../src/semantics/shared.ts';
export * from '../../../src/semantics/shared.ts';
export { s3 };
// The shared domain lifecycle and refresh belong to the API lane.
export { manifest as domainManifest } from '../../../api/src/manifest.ts';

export function hostOf(request: Request): string {
  return (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host).split(':')[0]!.toLowerCase();
}
export function endpointOf(host: string): { account: string; jurisdiction: string; bucket?: string } | undefined {
  // source: https://developers.cloudflare.com/r2/api/tokens/ "jurisdiction-specific endpoints"
  const match = /^(?:([^.]+)\.)?([0-9a-f]{32})(?:\.(eu|fedramp-high|fedramp|us))?\.r2\.cloudflarestorage\.com$/.exec(host);
  return match ? { account: match[2]!, jurisdiction: match[3] ?? 'default', ...(match[1] ? { bucket: match[1] } : {}) } : undefined;
}
export function here(ctx: HandlerContext): { account: string; jurisdiction: string; bucket?: string } {
  const endpoint = endpointOf(hostOf(ctx.call.request));
  if (!endpoint) throw new Error('R2 S3 operation reached a non-R2 endpoint');
  return endpoint;
}
export function error(code: string, message: string, status: number): Response {
  return s3.xmlAnswer(s3.doc('Error', [s3.x('Code', code), s3.x('Message', message)]), status);
}
export const denied = (): Response => error('AccessDenied', 'Insufficient permissions for the requested operation.', 403);
export const noBucket = (): Response => error('NoSuchBucket', 'The specified bucket does not exist.', 404);
export const noObject = (): Response => error('NoSuchKey', 'The specified object key does not exist.', 404);
export const invalid = (message: string): Response => error('InvalidArgument', message, 400);
export function bucketOf(ctx: HandlerContext, name = String(ctx.call.params.Bucket ?? '')): Row | undefined {
  const endpoint = here(ctx);
  const bucket = bucketNamed(ctx, endpoint.account, name);
  return bucket && bucket.jurisdiction === endpoint.jurisdiction ? bucket : undefined;
}
/** The bucket an upload writes to, made first when the request asks R2 to and it is not there yet. */
// source: https://developers.cloudflare.com/r2/api/s3/extensions/ "Add a cf-create-bucket-if-missing header with the value true to implicitly create the bucket if it does not exist yet."
export async function uploadBucket(ctx: HandlerContext): Promise<Row | undefined> {
  const held = bucketOf(ctx);
  if (held || ctx.call.request.headers.get('cf-create-bucket-if-missing') !== 'true' || !bucketNameValid(String(ctx.call.params.Bucket ?? ''))) return held;
  const endpoint = here(ctx);
  await putBucket(ctx, endpoint.account, String(ctx.call.params.Bucket), endpoint.jurisdiction, null);
  return bucketOf(ctx);
}
/** An owner (or an upload's initiator) as S3's XML names one: R2's is its account. */
// source: spec:/shapes/com.amazonaws.s3#Object "The owner of the object"
export const ownerXml = (account: string, element = 'Owner'): string => s3.x(element, [s3.x('ID', account), s3.x('DisplayName', account)]);
export function objectOf(ctx: HandlerContext, bucket: Row, key = String(ctx.call.params.Key ?? '')): Row | undefined {
  // kept under the bucket's own key, or under the adopted account's when a vendor-backed refresh observed it
  return ctx.row(OBJECT, objectKey(bucketAccount(bucket), String(bucket.name), key)) ?? ctx.row(OBJECT, objectKey(ctx.resolve('account', bucketAccount(bucket)), String(bucket.name), key));
}
/** A bucket's objects: each names its bucket by the parent field a vendor-backed refresh fills as well (`_bucket`, the
 *  bucket's stored id `<account>:<name>`). */
export function objectsOf(ctx: HandlerContext, bucket: Row): Row[] {
  return ctx.rowsRaw(OBJECT).filter(object => ofBucket(ctx, object._bucket, bucket));
}
export function keyValid(key: string): boolean {
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Maximum key length is 1024 bytes."
  return key.length > 0 && !key.includes('\0') && new TextEncoder().encode(key).byteLength <= 1024;
}
export async function payload(ctx: HandlerContext): Promise<Uint8Array> {
  return new Uint8Array(await ctx.call.request.clone().arrayBuffer());
}
export async function xmlBody(ctx: HandlerContext): Promise<string> {
  return new TextDecoder().decode(await payload(ctx));
}
export function unsupported(request: Request, operation: string): Response | undefined {
  // source: https://developers.cloudflare.com/r2/api/s3/api/ "Feature Not Implemented"
  const names = [...request.headers.keys()];
  const forbidden = names.some(name => /^x-amz-(?:acl|grant-|expected-bucket-owner|request-payer|tagging|object-lock|bucket-object-lock)/.test(name))
    || request.headers.has('x-amz-server-side-encryption')
    || names.some(name => name.startsWith('x-amz-server-side-encryption-aws-kms') || name === 'x-amz-website-redirect-location');
  const query = new URL(request.url).searchParams;
  if (forbidden || query.has('versionId') || query.has('tagging')) return error('NotImplemented', 'Not Implemented', 501);
  if (['PutBucketCors', 'PutBucketLifecycleConfiguration'].includes(operation)
    && (request.headers.has('x-amz-sdk-checksum-algorithm') || request.headers.has('x-amz-checksum-algorithm'))) return error('NotImplemented', 'Not Implemented', 501);
  // The selected wire has no chunk/trailer decoder yet. Refuse that unserved feature rather than store framing as bytes.
  // Where the reference stops: this uses the lane's documented unsupported-feature error class.
  if ((request.headers.get('x-amz-content-sha256') ?? '').startsWith('STREAMING-')) return error('NotImplemented', 'Streaming payload framing is not implemented.', 501);
  return undefined;
}

/** SSE-C identifies a customer's 256-bit key by its MD5; the World keeps logical bytes and never the key.
 *  The key a request supplies (`copy`: for its copy source), checked; null when it sends none. A write keeps it. */
// source: https://developers.cloudflare.com/r2/examples/ssec/ "The MD5 hash is not used in the encryption process itself."
export function customerEncryption(request: Request, copy = false): Row | null | Response {
  const prefix = copy ? 'x-amz-copy-source-server-side-encryption-customer-' : 'x-amz-server-side-encryption-customer-';
  const algorithm = request.headers.get(`${prefix}algorithm`);
  const key = request.headers.get(`${prefix}key`);
  const keyMd5 = request.headers.get(`${prefix}key-md5`);
  if (algorithm === null && key === null && keyMd5 === null) return null;
  // Where the documentation stops: R2's error codes have no SSE-C row (no InvalidEncryptionAlgorithmError, and its
  // InvalidDigest and BadDigest rows speak of checksum headers); S3's error list stands in for the algorithm's code and
  // text, and R2's own row text answers a code R2 has.
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-c-encryption.html "The header value must be AES256."
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The encryption request you specified is not valid. The valid value is AES256."
  if (algorithm !== null && algorithm !== 'AES256') return error('InvalidEncryptionAlgorithmError', 'The encryption request you specified is not valid. The valid value is AES256.', 400);
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-c-encryption.html "You must provide the following three API headers to encrypt or decrypt objects with SSE-C"
  // Where the documentation stops: neither S3's SSE-C pages nor its error list name the refusal of an incomplete set or of a
  // key that is not 256 bits; this answers the list's generic argument class.
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "Invalid Argument"
  if (algorithm === null || !key || !keyMd5) return invalid('SSE-C requires AES256, a customer key and its MD5.');
  const bytes = Buffer.from(key, 'base64');
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-c-encryption.html "Use this header to provide the 256-bit, base64-encoded encryption key"
  if (bytes.byteLength !== 32 || bytes.toString('base64') !== key) return invalid('The customer key must be a base64-encoded 256-bit key.');
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Checksum header format is malformed."
  if (!/^[A-Za-z0-9+/]{22}==$/.test(keyMd5)) return error('InvalidDigest', 'Checksum header format is malformed.', 400);
  // source: spec:/shapes/com.amazonaws.s3#PutObjectRequest/members/SSECustomerKeyMD5 "ensure that the encryption key was transmitted without error"
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Provided checksum does not match the uploaded content."
  if (s3.checksum('MD5', bytes) !== keyMd5) return error('BadDigest', 'Provided checksum does not match the uploaded content.', 400);
  return { algorithm, keyMd5 };
}
/** The key a request supplies for what a write `held` (an object, a copy source, an upload): that write's own key, or none
 *  where it was stored without one. `optional`: the request may leave the key out (the result is then null). */
export function heldEncryption(request: Request, held: Row | null | undefined, { copy = false, optional = false } = {}): Row | null | Response {
  const supplied = customerEncryption(request, copy); if (supplied instanceof Response) return supplied;
  // Where the documentation stops: S3's SSE-C pages give the headers for an object encrypted with SSE-C and no answer for
  // them sent for one stored without it; refused with the error list's generic argument class rather than answered (and
  // echoed) as though the bytes were encrypted.
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-c-encryption.html "If the source object is encrypted using SSE-C, you must provide encryption key information"
  if (!held) return supplied ? invalid('The encryption parameters are not applicable to this object.') : null;
  if (!supplied) return optional ? null : denied();
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/specifying-s3-c-encryption.html "Amazon S3 first verifies that the encryption key that you provided matches"
  // Where the documentation stops: no S3 or R2 page names the refusal of a missing or other key; this answers R2's
  // documented authorization class.
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Insufficient permissions for the requested operation."
  // source: https://developers.cloudflare.com/r2/examples/ssec/ "Cloudflare will be unable to recover the body of any objects encrypted using those keys."
  if (held.algorithm !== supplied.algorithm || held.keyMd5 !== supplied.keyMd5) return denied();
  return supplied;
}
// source: spec:/shapes/com.amazonaws.s3#PutObjectRequest/members/SSECustomerAlgorithm "Specifies the algorithm to use when encrypting the object"
export function encryptionHeaders(encryption: Row | null | undefined): Record<string, string> {
  return encryption ? { 'x-amz-server-side-encryption-customer-algorithm': String(encryption.algorithm),
    'x-amz-server-side-encryption-customer-key-md5': String(encryption.keyMd5) } : {};
}

/** The headers an object keeps and answers again (its type and the other system headers, its `x-amz-meta-*`), as a
 *  GetObject answers them: what a vendor-backed refresh keeps of that answer too (the r2 manifest's Object blob). */
export const SYSTEM_HEADERS = ['content-type', 'cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires'];
export function metadataOf(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) if (name.startsWith('x-amz-meta-') || SYSTEM_HEADERS.includes(name)) headers[name] = value;
  return headers;
}
/** An object's answer headers: its own, and its checksums (`x-amz-checksum-*`, kept with them) when asked for. */
export function objectHeaders(object: Row, checksums = false): Record<string, string> {
  const headers: Record<string, string> = {
    etag: String(object.ETag), 'last-modified': new Date(String(object.LastModified)).toUTCString(),
    'content-length': String(object.Size), 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes',
    'x-amz-storage-class': String(object.StorageClass ?? 'STANDARD'),
  };
  for (const [name, value] of Object.entries((object._headers ?? {}) as Row)) if (checksums || !name.startsWith('x-amz-checksum-')) headers[name] = String(value);
  return headers;
}
export function conditions(request: Request, object: Row | undefined, prefix = ''): Response | undefined {
  const etag = String(object?.ETag ?? '');
  const modified = object ? Math.floor(Date.parse(String(object.LastModified)) / 1000) * 1000 : undefined;
  const matches = (condition: string): boolean => condition.split(',').map(value => value.trim()).some(value => value === '*' ? !!object : value === etag);
  const get = (name: string): string | null => request.headers.get(prefix ? `x-amz-copy-source-${name}` : name);
  const match = get('if-match');
  if (match !== null && !matches(match)) return error('PreconditionFailed', 'The precondition did not hold.', 412);
  const unmodified = get('if-unmodified-since');
  if (match === null && unmodified && modified !== undefined && Number.isFinite(Date.parse(unmodified)) && modified > Date.parse(unmodified)) return error('PreconditionFailed', 'The precondition did not hold.', 412);
  const none = get('if-none-match');
  if (none !== null && matches(none)) return ['GET', 'HEAD'].includes(request.method) && !prefix ? new Response(null, { status: 304, headers: object ? objectHeaders(object) : {} }) : error('PreconditionFailed', 'The precondition did not hold.', 412);
  const since = get('if-modified-since');
  if (none === null && since && modified !== undefined && Number.isFinite(Date.parse(since)) && modified <= Date.parse(since)) return !prefix && ['GET', 'HEAD'].includes(request.method) ? new Response(null, { status: 304, headers: object ? objectHeaders(object) : {} }) : error('PreconditionFailed', 'The precondition did not hold.', 412);
  return undefined;
}
export function rangeOf(header: string | null, size: number): { start: number; end: number } | undefined | false {
  if (header === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2] || size === 0) return false;
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : false;
}
export async function readObject(ctx: HandlerContext, bucket: Row, key: string, request: Request): Promise<Response> {
  const object = objectOf(ctx, bucket, key);
  if (!object) return noObject();
  const encryption = heldEncryption(request, object._ssec as Row | null | undefined);
  if (encryption instanceof Response) return encryption;
  const refusal = conditions(request, object); if (refusal) return refusal;
  const headers = { ...encryptionHeaders(encryption), ...objectHeaders(object, request.headers.get('x-amz-checksum-mode') === 'ENABLED') };
  // source: https://developers.cloudflare.com/r2/api/s3/api/ "Range (has no effect in HeadObject)"
  let range = rangeOf(request.method === 'HEAD' ? null : request.headers.get('range'), Number(object.Size));
  // source: spec:/shapes/com.amazonaws.s3#GetObjectRequest "Effectively performs a 'ranged' GET request for the part specified."
  const part = new URL(request.url).searchParams.get('partNumber');
  if (part !== null) {
    const number = Number(part); const sizes = (object._partSizes ?? [Number(object.Size)]) as number[];
    if (!Number.isInteger(number) || number < 1 || number > sizes.length) return error('InvalidRange', 'Requested part is not satisfiable.', 416);
    const start = sizes.slice(0, number - 1).reduce((sum, size) => sum + size, 0);
    range = { start, end: start + sizes[number - 1]! - 1 };
    headers['x-amz-mp-parts-count'] = String(sizes.length);
  }
  if (range === false) return error('InvalidRange', 'Requested byte range is not satisfiable.', 416);
  if (range) { headers['content-range'] = `bytes ${range.start}-${range.end}/${object.Size}`; headers['content-length'] = String(range.end - range.start + 1); }
  // a HEAD ignores a Range header alone (above)
  // source: spec:/shapes/com.amazonaws.s3#HeadObjectRequest/members/PartNumber "performs a 'ranged' HEAD request for the part specified"
  // Where the documentation stops: neither R2's nor S3's pages state the status of a HEAD for a part; a ranged request
  // answers 206 (as the GET of a part does), so the HEAD of a part is answered 206 by that inference.
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  const bytes = await ctx.blobs.get(String(object._blob));
  if (bytes === null) missingObjectBlob();
  return ctx.raw((range ? bytes.slice(range.start, range.end + 1) : bytes) as Uint8Array<ArrayBuffer>, { status: range ? 206 : 200, headers });
}
export async function writeObject(ctx: HandlerContext, bucket: Row, key: string, bytes: Uint8Array, fields: Row,
  operation: string, etag = `"${ctx.crypto.md5(bytes)}"`): Promise<Row> {
  const blob = `r2/objects/${ctx.crypto.sha256(bytes as unknown as string)}`;
  await ctx.blobs.put(blob, bytes);
  // the object's own row when it has one (a refresh may have observed it under the adopted account's key), else the bucket's key
  const id = String(objectOf(ctx, bucket, key)?.id ?? objectKey(bucketAccount(bucket), String(bucket.name), key));
  await ctx.write(OBJECT, id, { ...fields, Key: key, _bucket: ctx.row(OBJECT, id)?._bucket ?? bucket.id,
    Size: bytes.byteLength, ETag: etag, LastModified: ctx.occurredAt, StorageClass: fields.StorageClass ?? 'STANDARD', _blob: blob, deleted: false }, operation);
  return ctx.row(OBJECT, id)!;
}
export function uploadOf(ctx: HandlerContext, bucket: Row, key: string, uploadId: string): Row | undefined {
  const upload = ctx.row(UPLOAD, uploadId);
  return upload && ofBucket(ctx, upload._bucket, bucket) && upload.Key === key ? upload : undefined;
}
/** An upload's parts, by the parent field a vendor-backed refresh fills as well (`_upload`). */
export function partsOf(ctx: HandlerContext, uploadId: string): Row[] {
  return ctx.rowsRaw(PART).filter(part => part._upload === uploadId).sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber));
}
export async function discardUpload(ctx: HandlerContext, uploadId: string, operation: string): Promise<void> {
  for (const part of partsOf(ctx, uploadId)) await ctx.remove(PART, String(part.id), operation);
  await ctx.remove(UPLOAD, uploadId, operation);
}

export const CHECKSUMS = ['CRC32', 'CRC32C', 'CRC64NVME', 'SHA1', 'SHA256'] as const;
export function checksumFields(request: Request, bytes: Uint8Array): { fields: Row; refusal?: Response } {
  const fields: Row = {};
  const check = (name: string, algorithm: s3.ChecksumAlgorithm): Response | undefined => {
    const value = request.headers.get(name); if (value === null) return undefined;
    const expected = s3.checksum(algorithm, bytes);
    // source: https://developers.cloudflare.com/r2/api/error-codes/ "Checksum header format is malformed."
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || Buffer.from(value, 'base64').byteLength !== Buffer.from(expected, 'base64').byteLength) return error('InvalidDigest', 'Checksum header format is malformed.', 400);
    // source: https://developers.cloudflare.com/r2/api/error-codes/ "Provided checksum does not match the uploaded content."
    if (value !== expected) return error('BadDigest', 'Provided checksum does not match the uploaded content.', 400);
    if (algorithm !== 'MD5') fields[name] = expected;
    return undefined;
  };
  // source: https://developers.cloudflare.com/r2/api/error-codes/ "Provided checksum does not match the uploaded content."
  const md5 = check('content-md5', 'MD5'); if (md5) return { fields, refusal: md5 };
  for (const algorithm of CHECKSUMS) {
    const refused = check(`x-amz-checksum-${algorithm.toLowerCase()}`, algorithm); if (refused) return { fields, refusal: refused };
  }
  const chosen = request.headers.get('x-amz-sdk-checksum-algorithm');
  if (chosen && (!CHECKSUMS.includes(chosen as typeof CHECKSUMS[number]) || !request.headers.has(`x-amz-checksum-${chosen.toLowerCase()}`))) return { fields, refusal: invalid('A supported checksum algorithm requires its checksum header.') };
  return { fields };
}
export function metadataRefusal(request: Request): Response | undefined {
  let size = 0;
  for (const [name, value] of request.headers) if (name.startsWith('x-amz-meta-')) size += new TextEncoder().encode(name.slice(11) + value).byteLength;
  return size > 8192 ? error('MetadataTooLarge', 'Object metadata is too large.', 400) : undefined;
}
export function storageClassOf(request: Request, bucket?: Row): string | undefined {
  const value = request.headers.get('x-amz-storage-class') ?? (bucket?.storage_class === 'InfrequentAccess' ? 'STANDARD_IA' : 'STANDARD');
  return value === 'STANDARD' || value === 'STANDARD_IA' ? value : undefined;
}
export function sourceOf(ctx: HandlerContext): { bucket: Row; key: string; object: Row } | Response {
  const header = ctx.call.request.headers.get('x-amz-copy-source');
  if (!header) return invalid('A copy source is required.');
  let source: string;
  try { source = decodeURIComponent(header).replace(/^\//, ''); } catch { return invalid('Invalid copy source.'); }
  const slash = source.indexOf('/'); if (slash < 1) return invalid('Invalid copy source.');
  const name = source.slice(0, slash); const key = source.slice(slash + 1);
  const bucket = bucketOf(ctx, name); if (!bucket) return noBucket();
  const object = objectOf(ctx, bucket, key); if (!object) return noObject();
  const endpoint = here(ctx); const url = new URL(ctx.call.request.url);
  const keyId = /Credential=([^/]+)/.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1]
    ?? url.searchParams.get('X-Amz-Credential')?.split('/')[0];
  const token = keyId ? ctx.row(API_TOKEN, keyId) : undefined;
  const temporary = keyId ? ctx.row(TEMPORARY, keyId) : undefined;
  const parent = temporary ? ctx.row(API_TOKEN, String(temporary.parent_id)) : token;
  if (!parent || !r2Grant(ctx, parent, endpoint.account, endpoint.jurisdiction, name, false, false)
    || temporary && !temporaryGrant(temporary, name, key, false, ctx.occurredAt)) return denied();
  const encryption = heldEncryption(ctx.call.request, object._ssec as Row | null | undefined, { copy: true });
  if (encryption instanceof Response) return encryption;
  const refused = conditions(ctx.call.request, object, 'copy'); if (refused) return refused;
  return { bucket, key, object };
}
export function temporaryGrant(credential: Row, bucket: string | undefined, key: string, mutation: boolean, at: string): boolean {
  if (!bucket || credential.bucket !== bucket || Date.parse(String(credential.expires_at)) <= Date.parse(at)) return false;
  if (mutation && !['object-read-write', 'admin-read-write'].includes(String(credential.permission))) return false;
  const objects = (credential.objects ?? []) as string[];
  const prefixes = (credential.prefixes ?? []) as string[];
  return !objects.length && !prefixes.length || objects.includes(key) || prefixes.some(prefix => key.startsWith(prefix));
}
export function r2PublicDomain(ctx: HandlerContext, host: string): Row | undefined {
  return ctx.rowsRaw(DOMAIN).find(domain => domain.domain === host && domain.enabled === true
    && (domain.status as Row | undefined)?.ownership === 'active' && (domain.status as Row | undefined)?.ssl === 'active');
}

export function keyAllowed(ctx: HandlerContext, key: string, mutation: boolean): boolean {
  const url = new URL(ctx.call.request.url);
  const keyId = /Credential=([^/]+)/.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1]
    ?? url.searchParams.get('X-Amz-Credential')?.split('/')[0];
  const temporary = keyId ? ctx.row(TEMPORARY, keyId) : undefined;
  return !temporary || temporaryGrant(temporary, String(ctx.call.params.Bucket ?? here(ctx).bucket ?? ''), key, mutation, ctx.occurredAt);
}
export const lexical = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
export async function listObjects(ctx: HandlerContext, v2: boolean): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const query = new URL(ctx.call.request.url).searchParams;
  const prefix = query.get('prefix') ?? ''; const delimiter = query.get('delimiter') ?? '';
  const encoding = query.get('encoding-type'); if (encoding && encoding !== 'url') return invalid('Invalid encoding type.');
  const encode = (key: string): string => encoding ? encodeURIComponent(key) : key;
  const max = Number(query.get('max-keys') ?? 1000);
  if (!Number.isInteger(max) || max < 0) return invalid('Invalid max-keys.');
  const limit = Math.min(1000, max);
  const scope = `${bucket.account_id}:${bucket.jurisdiction}:${bucket.name}:${prefix}:${delimiter}`;
  const secret = await ctx.secret('r2-list-continuation');
  const continuation = (key: string): string => {
    const data = Buffer.from(JSON.stringify({ scope, key })).toString('base64url');
    return `${data}.${ctx.crypto.hmac(secret, data, 'base64url')}`;
  };
  let after = v2 ? query.get('start-after') ?? '' : query.get('marker') ?? '';
  const token = query.get('continuation-token');
  if (v2 && token) {
    const [data, signature, extra] = token.split('.');
    if (!data || !signature || extra || !ctx.crypto.equalSecrets(signature, ctx.crypto.hmac(secret, data, 'base64url'))) return invalid('Invalid continuation token.');
    // a token whose signature holds is one this list issued, so its data is the JSON it signed
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString()) as Row;
    if (decoded.scope !== scope || typeof decoded.key !== 'string') return invalid('Invalid continuation token.');
    after = decoded.key;
  }
  const all = new Map<string, Row | undefined>();
  for (const object of objectsOf(ctx, bucket).filter(row => String(row.Key).startsWith(prefix) && keyAllowed(ctx, String(row.Key), false))) {
    const key = String(object.Key); const at = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
    if (at >= 0) all.set(key.slice(0, at + delimiter.length), undefined); else all.set(key, object);
  }
  const entries = [...all.entries()].sort(([a], [b]) => lexical(a, b)).filter(([key]) => !after || lexical(key, after) > 0);
  const page = entries.slice(0, limit); const truncated = limit > 0 && entries.length > limit;
  // a version 1 listing names each object's owner, as S3's ListObjects answers it
  const contents = page.map(([key, object]) => object ? s3.x('Contents', [s3.x('Key', encode(key)), s3.x('LastModified', String(object.LastModified)),
    s3.x('ETag', String(object.ETag)), s3.x('Size', Number(object.Size)), s3.x('StorageClass', String(object.StorageClass ?? 'STANDARD')), ...(v2 && query.get('fetch-owner') !== 'true' ? [] : [ownerXml(String(bucket.account_id))])])
    : s3.x('CommonPrefixes', [s3.x('Prefix', encode(key))]));
  return s3.xmlAnswer(s3.doc('ListBucketResult', [s3.x('Name', String(bucket.name)), s3.x('Prefix', encode(prefix)),
    ...(delimiter ? [s3.x('Delimiter', encode(delimiter))] : []), s3.x('MaxKeys', limit), s3.x('IsTruncated', String(truncated)),
    ...(encoding ? [s3.x('EncodingType', encoding)] : []),
    ...(v2 ? [s3.x('KeyCount', page.length), ...(token ? [s3.x('ContinuationToken', token)] : []),
      ...(query.has('start-after') ? [s3.x('StartAfter', encode(query.get('start-after')!))] : []),
      ...(truncated ? [s3.x('NextContinuationToken', continuation(page.at(-1)![0]))] : [])]
      : [s3.x('Marker', encode(after)), ...(truncated && delimiter ? [s3.x('NextMarker', encode(page.at(-1)![0]))] : [])]), ...contents]));
}

export const noUpload = (): Response => error('NoSuchUpload', 'The specified multipart upload does not exist.', 404);
export async function putPart(ctx: HandlerContext, upload: Row, number: number, bytes: Uint8Array, checksums: Row, operation: string): Promise<Row | Response> {
  if (!Number.isInteger(number) || number < 1 || number > 10000) return invalid('Part number must be between 1 and 10000.');
  if (bytes.byteLength > 5 * 1024 ** 3) return error('EntityTooLarge', 'Part is too large.', 400);
  const id = `${upload.id}:${number}`; const blob = `r2/parts/${ctx.crypto.sha256(bytes as unknown as string)}`;
  await ctx.blobs.put(blob, bytes);
  await ctx.write(PART, id, { PartNumber: number, _upload: upload.id, LastModified: ctx.occurredAt,
    ETag: `"${ctx.crypto.md5(bytes)}"`, Size: bytes.byteLength, _blob: blob, checksums, deleted: false }, operation);
  return ctx.row(PART, id)!;
}
export async function listUploads(ctx: HandlerContext): Promise<Response> {
  const bucket = bucketOf(ctx); if (!bucket) return noBucket();
  const query = new URL(ctx.call.request.url).searchParams; const prefix = query.get('prefix') ?? ''; const delimiter = query.get('delimiter') ?? '';
  const encoding = query.get('encoding-type'); if (encoding && encoding !== 'url') return invalid('Invalid encoding type.');
  const encode = (key: string): string => encoding ? encodeURIComponent(key) : key;
  const keyMarker = query.get('key-marker') ?? ''; const uploadMarker = query.get('upload-id-marker') ?? '';
  const asked = Number(query.get('max-uploads') ?? 1000); if (!Number.isInteger(asked) || asked < 0) return invalid('Invalid max-uploads.');
  const limit = Math.min(1000, asked);
  const entries: Array<{ key: string; id: string; upload?: Row }> = []; const prefixes = new Set<string>();
  for (const upload of ctx.rowsRaw(UPLOAD).filter(row => ofBucket(ctx, row._bucket, bucket) && String(row.Key).startsWith(prefix) && keyAllowed(ctx, String(row.Key), false))) {
    const key = String(upload.Key); const id = String(upload.UploadId); const at = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
    if (at >= 0) prefixes.add(key.slice(0, at + delimiter.length)); else entries.push({ key, id, upload });
  }
  entries.push(...[...prefixes].map(key => ({ key, id: '' })));
  const all = entries.sort((a, b) => lexical(a.key, b.key) || lexical(a.id, b.id))
    .filter(entry => !keyMarker || lexical(entry.key, keyMarker) > 0 || entry.key === keyMarker && !!uploadMarker && lexical(entry.id, uploadMarker) > 0);
  const page = all.slice(0, limit); const truncated = limit > 0 && all.length > limit;
  return s3.xmlAnswer(s3.doc('ListMultipartUploadsResult', [s3.x('Bucket', String(bucket.name)), s3.x('KeyMarker', encode(keyMarker)), s3.x('UploadIdMarker', uploadMarker),
    ...(truncated ? [s3.x('NextKeyMarker', encode(page.at(-1)!.key)), s3.x('NextUploadIdMarker', page.at(-1)!.id)] : []),
    s3.x('Prefix', encode(prefix)), ...(encoding ? [s3.x('EncodingType', encoding)] : []), ...(delimiter ? [s3.x('Delimiter', encode(delimiter))] : []), s3.x('MaxUploads', limit), s3.x('IsTruncated', String(truncated)),
    ...page.map(entry => entry.upload ? s3.x('Upload', [s3.x('Key', encode(entry.key)), s3.x('UploadId', entry.id), ownerXml(String(bucket.account_id), 'Initiator'), ownerXml(String(bucket.account_id)), s3.x('StorageClass', String(entry.upload.StorageClass)), s3.x('Initiated', String(entry.upload.Initiated))]) : s3.x('CommonPrefixes', [s3.x('Prefix', encode(entry.key))]))]));
}

// source: https://developers.cloudflare.com/r2/buckets/cors/ "Use CORS with a public bucket"
export function preflight(request: Request, rules: s3.CorsRule[]): Response {
  const origin = request.headers.get('origin');
  if (!origin) return error('AccessForbidden', 'CORS request requires an Origin.', 403);
  const method = request.headers.get('access-control-request-method') ?? '';
  const requested = s3.requestedHeaders(request); const rule = s3.corsRuleFor(rules, origin, method, requested);
  return rule ? new Response(null, { status: 200, headers: s3.corsHeaders(rule, origin, requested, true) })
    : error('AccessForbidden', 'CORS request is not allowed.', 403);
}
// source: https://developers.cloudflare.com/r2/buckets/cors/ "Access-Control-Expose-Headers"
export function corsAnswer(request: Request, rules: s3.CorsRule[], response: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin) return response;
  const rule = s3.corsRuleFor(rules, origin, request.method, []); if (!rule) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(s3.corsHeaders(rule, origin, [], false))) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Only corrupt engine state can make a successfully stored/refreshed object lose its blob. */
export function missingObjectBlob(): never {
  throw new Error('An R2 object references a missing World blob');
}

/** Date milliseconds narrow only after exact day arithmetic fits the clock's range. */
export function lifecycleDue(created: number, days: number | string | undefined): number {
  if (!Number.isSafeInteger(created) || days === undefined || !/^-?\d+$/.test(String(days))) return NaN;
  const due = BigInt(created) + BigInt(String(days)) * 86400000n;
  return due > 8640000000000000n ? Infinity : due < -8640000000000000n ? -Infinity : Number(due);
}
