// What the s3 lane's handlers, front and door share: the vendor's (../../../src/semantics/shared.ts), and S3's own. Every
// subject is stored as S3 answers it, so a write and a vendor-backed refresh store one shape (the manifest's refresh):
// a bucket (`s3_bucket`, its name) as ListBuckets answers it; an object (`s3_object`, `<bucket>/<key>`) as ListObjectsV2
// answers it, its bytes in the World's blobs under `_blob` and the headers GetObject answers them with under `_headers`;
// an in-progress multipart upload (`s3_upload`, its UploadId) as ListMultipartUploads answers it; an uploaded part
// (`s3_part`, `<upload>:<number>`) as ListParts answers it, its bytes under `_blob`. Each names its parent privately
// (`_bucket`, `_upload`).
export * from '../../../src/semantics/shared.ts';
import { s3, sha256, type HandlerContext } from '@volter/world-core';
import { worldAccountOf } from '../../../src/semantics/shared.ts';

const { doc, x, xmlAnswer } = s3;

export type Row = Record<string, unknown>;
export const BUCKET = 'Bucket';
export const OBJECT = 's3_object';
export const UPLOAD = 's3_upload';
const PART = 's3_part';

// source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html "Part size 5 MiB to 5 GiB. There is no minimum size limit on the last part of your multipart upload."
export const MIN_PART = 5 * 1024 * 1024;
// source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html "Part numbers 1 to 10,000 (inclusive)"
const MAX_PART_NUMBER = 10_000;

/** S3's error answer: an XML Error with its Code and Message. */
export const refuse = (status: number, code: string, message: string): Response => xmlAnswer(doc('Error', [x('Code', code), x('Message', message)]).replace(/ xmlns="[^"]*"/, ''), status);
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The specified bucket does not exist."
export const noSuchBucket = (): Response => refuse(404, 'NoSuchBucket', 'The specified bucket does not exist');
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The specified key does not exist."
export const noSuchKey = (): Response => refuse(404, 'NoSuchKey', 'The specified key does not exist.');
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The specified multipart upload does not exist. The upload ID might be invalid, or the multipart upload might have been aborted or completed."
export const noSuchUpload = (): Response => refuse(404, 'NoSuchUpload', 'The specified multipart upload does not exist. The upload ID might be invalid, or the multipart upload might have been aborted or completed.');
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The XML you provided was not well-formed or did not validate against our published schema."
export const malformedXml = (): Response => refuse(400, 'MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema.');
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "Invalid Argument"
export const invalidArgument = (message: string): Response => refuse(400, 'InvalidArgument', message);

export const bucketName = (ctx: HandlerContext): string => decodeURIComponent(String(ctx.call.params.Bucket ?? ''));
export const keyName = (ctx: HandlerContext): string => decodeURIComponent(String(ctx.call.params.Key ?? ''));
export const query = (ctx: HandlerContext): URLSearchParams => new URL(ctx.call.request.url).searchParams;
const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);
export const bucketOf = (ctx: HandlerContext, name: string): Row | undefined => {
  const bucket = live(ctx.row(BUCKET, name));
  return bucket && (bucket._world_account ?? 'default') === worldAccountOf(ctx) ? bucket : undefined;
};
export const objectOf = (ctx: HandlerContext, bucket: string, key: string): Row | undefined => live(ctx.row(OBJECT, `${bucket}/${key}`));
/** A bucket's objects in UTF-8 binary order of their keys, as S3 lists them. */
export const objectsIn = (ctx: HandlerContext, bucket: string): Row[] => ctx.rowsRaw(OBJECT).filter((o) => o._bucket === bucket && o.deleted !== true).sort((a, b) => lexical(String(a.Key), String(b.Key)));
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html "ListObjectsV2 returns objects in lexicographical order based on their key names."
export const lexical = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const httpDate = (iso: unknown): string => new Date(String(iso)).toUTCString();

/** The account's canonical user ID: 64 hex digits drawn from a secret the World holds (where the documentation stops: its
 *  form, as ListBuckets' Owner shows it). */
export const canonicalId = async (ctx: HandlerContext): Promise<string> => sha256(await ctx.secret('s3-canonical-user'));

// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html "The response headers that you can override for the GetObject response are Cache-Control , Content-Disposition , Content-Encoding , Content-Language , Content-Type , and Expires ."
const SYSTEM_HEADERS = ['cache-control', 'content-disposition', 'content-encoding', 'content-language', 'content-type', 'expires'];
/** The checksums S3 checks and keeps with an object (x-amz-checksum-<algorithm>), those the kernel's S3 wire computes. */
// source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html "You can provide a precalculated MD5 checksum using the x-amz-checksum-md5 header."
const CHECKSUMS = ['CRC32', 'CRC32C', 'CRC64NVME', 'SHA1', 'SHA256', 'MD5'] as const;

/** The headers an object keeps from the write that made it and answers again: its system headers, its `x-amz-meta-*`, its
 *  tag count, and the encryption it is stored under. */
export function metadataOf(request: Request): Record<string, string> {
  const kept: Record<string, string> = {};
  request.headers.forEach((v, k) => { if (SYSTEM_HEADERS.includes(k) || k.startsWith('x-amz-meta-')) kept[k] = v; });
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html "Amazon S3 now applies server-side encryption with Amazon S3 managed keys (SSE-S3) as the base level of encryption for every bucket in Amazon S3."
  kept['x-amz-server-side-encryption'] = request.headers.get('x-amz-server-side-encryption') ?? 'AES256';
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html "x-amz-tagging-count"
  const tagging = request.headers.get('x-amz-tagging');
  if (tagging) kept['x-amz-tagging-count'] = String(new URLSearchParams(tagging).size);
  return kept;
}

/** A write's payload checked as S3 checks it: its Content-MD5 and any `x-amz-checksum-<algorithm>` the client computed,
 *  each the bytes' own; the checksums kept with the object. Where the documentation stops: the message names the digest. */
export function integrity(request: Request, bytes: Uint8Array): { checksums: Record<string, string> } | Response {
  const md5 = request.headers.get('content-md5');
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The Content-MD5 you specified did not match what we received."
  if (md5 !== null && md5 !== s3.checksum('MD5', bytes)) return refuse(400, 'BadDigest', 'The Content-MD5 you specified did not match what we received.');
  const checksums: Record<string, string> = {};
  for (const algorithm of CHECKSUMS) {
    const name = `x-amz-checksum-${algorithm.toLowerCase()}`;
    const sent = request.headers.get(name);
    if (sent === null) continue;
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html "Amazon S3 fails the request with a BadDigest error."
    if (sent !== s3.checksum(algorithm, bytes)) return refuse(400, 'BadDigest', `The ${algorithm} you specified did not match the calculated checksum.`);
    checksums[name] = sent;
  }
  return { checksums };
}

/** A request S3 serves a feature of that this lane does not: an ACL other than the bucket owner's full control (a new
 *  bucket's ACLs are disabled), or a payload sent in aws-chunked framing, which the lane does not decode. */
export function unserved(request: Request): Response | undefined {
  const acl = request.headers.get('x-amz-acl');
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html "PUT requests that contain other ACLs (for example, custom grants to certain AWS accounts) fail and return a 400 error with the error code AccessControlListNotSupported ."
  if ((acl !== null && acl !== 'bucket-owner-full-control') || [...request.headers.keys()].some((h) => h.startsWith('x-amz-grant-'))) return refuse(400, 'AccessControlListNotSupported', 'The bucket does not allow ACLs');
  // the chunked upload framing (STREAMING-* payload hashes) is not decoded here: the lane's answer to a feature it does
  // not serve, S3's NotImplemented, rather than keep the framing as the object's bytes
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "A header you provided implies functionality that is not implemented."
  if ((request.headers.get('x-amz-content-sha256') ?? '').startsWith('STREAMING-')) return refuse(501, 'NotImplemented', 'A header you provided implies functionality that is not implemented');
  return undefined;
}

/** An object's answer headers: its ETag, length, time and storage class, the headers it keeps (its checksums only when
 *  asked for), and on a GET the response-* query parameters that override them. */
export function objectHeaders(o: Row, request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    etag: String(o.ETag), 'last-modified': httpDate(o.LastModified), 'content-length': String(Number(o.Size)), 'accept-ranges': 'bytes',
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html "Content-Type"
    'content-type': 'binary/octet-stream',
  };
  const checksums = request?.headers.get('x-amz-checksum-mode') === 'ENABLED';
  for (const [k, v] of Object.entries((o._headers ?? {}) as Record<string, string>)) if (checksums || !k.startsWith('x-amz-checksum-')) headers[k] = String(v);
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html "Amazon S3 returns this header for all objects except for S3 Standard storage class objects."
  if (o.StorageClass && o.StorageClass !== 'STANDARD') headers['x-amz-storage-class'] = String(o.StorageClass);
  const url = request ? new URL(request.url) : undefined;
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html "response-content-type Sets the Content-Type header of the response."
  for (const h of SYSTEM_HEADERS) { const v = url?.searchParams.get(`response-${h}`); if (v !== null && v !== undefined) headers[h] = v; }
  return headers;
}

/** One byte range of an object (`bytes=a-b`, `bytes=a-`, `bytes=-n`), or false when it cannot be satisfied. */
// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html "Downloads the specified byte range of an object."
export function rangeOf(header: string | null, size: number): { start: number; end: number } | undefined | false {
  if (header === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start <= end && start < size ? { start, end } : false;
}

/** An object written: its bytes kept in the World's blobs by their digest, its row as ListObjectsV2 answers it. */
export async function writeObject(ctx: HandlerContext, bucket: string, key: string, bytes: Uint8Array, fields: { _headers: Record<string, string>; StorageClass: string; ETag?: string }, operation: string): Promise<Row> {
  const blob = `s3/objects/${ctx.crypto.digest('sha256', bytes)}-${bytes.length}`;
  await ctx.blobs.put(blob, bytes);
  const id = `${bucket}/${key}`;
  await ctx.write(OBJECT, id, {
    Key: key, LastModified: ctx.occurredAt, ETag: fields.ETag ?? `"${ctx.crypto.md5(bytes)}"`, Size: bytes.length, StorageClass: fields.StorageClass,
    _bucket: bucket, _blob: blob, _headers: fields._headers, deleted: false,
  }, operation);
  return ctx.row(OBJECT, id)!;
}

/** The bytes an object or a part keeps in the World's blobs. One a refresh observed without them (a part: no operation
 *  downloads one) holds none the World can answer with, and that is the World's failure, never an empty object. */
export async function heldBytes(ctx: HandlerContext, row: Row): Promise<Uint8Array> {
  const bytes = row._blob === undefined ? null : await ctx.blobs.get(String(row._blob));
  if (bytes === null) throw new Error(`the World holds no bytes for ${String(row.id)}: a refresh observed it without them`);
  return bytes;
}

/** The in-progress upload a request names (its `uploadId`), for its bucket and key. */
export function uploadOf(ctx: HandlerContext): Row | undefined {
  const u = live(ctx.row(UPLOAD, query(ctx).get('uploadId') ?? ''));
  return u && u._bucket === bucketName(ctx) && u.Key === keyName(ctx) ? u : undefined;
}
/** An upload's parts, by part number. */
export const partsOf = (ctx: HandlerContext, uploadId: string): Row[] => ctx.rowsRaw(PART).filter((p) => p._upload === uploadId && p.deleted !== true).sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber));

/** The part number a request names, or S3's refusal of one outside 1 to 10,000. */
export function partNumber(ctx: HandlerContext): number | Response {
  const n = Number(query(ctx).get('partNumber'));
  return Number.isInteger(n) && n >= 1 && n <= MAX_PART_NUMBER ? n : invalidArgument('Part number must be an integer between 1 and 10000, inclusive');
}

/** A part's bytes kept for its upload, its row as ListParts answers it (a part sent again under its number replaces it). */
export async function keepPart(ctx: HandlerContext, upload: Row, n: number, bytes: Uint8Array, checksums: Record<string, string>): Promise<Row> {
  const blob = `s3/parts/${ctx.crypto.digest('sha256', bytes)}-${bytes.length}`;
  await ctx.blobs.put(blob, bytes);
  const id = `${String(upload.id)}:${n}`;
  await ctx.write(PART, id, { PartNumber: n, LastModified: ctx.occurredAt, ETag: `"${ctx.crypto.md5(bytes)}"`, Size: bytes.length,
    ...Object.fromEntries(Object.entries(checksums).map(([h, v]) => [`Checksum${h.slice('x-amz-checksum-'.length).toUpperCase()}`, v])),
    _upload: upload.id, _blob: blob, deleted: false }, 'UploadPart');
  return ctx.row(PART, id)!;
}

/** An upload ended (completed or aborted): its parts and the upload itself gone, as ListMultipartUploads no longer lists it. */
export async function closeUpload(ctx: HandlerContext, upload: Row, operation: string): Promise<void> {
  for (const p of partsOf(ctx, String(upload.id))) await ctx.remove(PART, String(p.id), operation);
  await ctx.remove(UPLOAD, String(upload.id), operation);
}

/** An Owner or Initiator element: the account's canonical user ID. */
export const ownerXml = (id: string, element = 'Owner'): string => x(element, [x('ID', id)]);
