// THE UPLOAD BUCKETS — reddit-uploaded-media.s3-accelerate.amazonaws.com and reddit-uploaded-video.s3-accelerate.amazonaws.com
// (a content screen, twin-world's architecture, "Screens"): where a media lease's S3 form is posted (POST /api/media/asset.json
// answers its action and fields; PRAW's _post_to_s3 and the campaign's sender post every field, then the file). The
// form is held to the lease's policy as S3 holds a POST policy: its signature, its expiry and each of its conditions,
// the file's size inside its content-length-range; a file that passes is kept as the lease's bytes and answered 201
// with S3's PostResponse (Location, Bucket, Key, ETag), as recorded on 2025-05-07. An object is private (the lease's
// acl): reading it back is refused. Answers carry S3's CORS for reddit.com's own page, which posts here from the browser.
import { s3, type HandlerContext } from '@volter/world-core';
import { ASSET, bucketHost, hostOf, MEDIA_BUCKET, mediaFacts, nowSeconds, VIDEO_BUCKET } from '../semantics/shared.ts';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, HEAD', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'ETag, Location' };

/** The host the request was made to: the World's proxy keeps it in Host, or names it when it rewrote Host. */

/** S3's error document. */
async function s3Error(ctx: HandlerContext, status: number, code: string, message: string, extra: Record<string, string | number> = {}): Promise<Response> {
  const requestId = ctx.crypto.sha256(`${await ctx.secret('s3-request')}:${ctx.occurredAt}:${code}`).slice(0, 16).toUpperCase();
  const inner = [s3.x('Code', code), s3.x('Message', message), ...Object.entries(extra).map(([k, v]) => s3.x(k, v)), s3.x('RequestId', requestId), s3.x('HostId', btoa(requestId))];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Error>${inner.join('')}</Error>`, { status, headers: { 'content-type': 'application/xml', ...CORS } });
}

/** An object read back from the bucket: the lease's acl is private (recorded 2025-05-07), so S3 refuses it.
 *  source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "Access Denied" */
function privateObject(ctx: HandlerContext): Promise<Response> {
  return s3Error(ctx, 403, 'AccessDenied', 'Access Denied');
}

/** A form whose policy is not one a lease of this bucket signed: S3's refusal of a signature it did not make.
 *  source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "SignatureDoesNotMatch" */
function unsigned(ctx: HandlerContext): Promise<Response> {
  return s3Error(ctx, 403, 'SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided. Check your key and signing method.');
}

/** A form field the policy's conditions do not cover: S3 refuses the form.
 *  Where the documentation stops: AWS's POST policy pages (which state that each form field but these must be covered
 *  by a condition) answer only a script to a fetch; AWS's error list names the code, AccessDenied, and the words are S3's
 *  own answer to such a form.
 *  source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "AccessDenied" */
function extraField(ctx: HandlerContext, name: string): Promise<Response> {
  return s3Error(ctx, 403, 'AccessDenied', `Invalid according to Policy: Extra input fields: ${name}`);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const host = hostOf(request);
  const bucket = host === bucketHost(VIDEO_BUCKET) ? VIDEO_BUCKET : MEDIA_BUCKET;
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (request.method === 'GET' || request.method === 'HEAD') return privateObject(ctx);
  if (request.method !== 'POST') return s3Error(ctx, 405, 'MethodNotAllowed', 'The specified method is not allowed against this resource.');
  const parts = await ctx.parts();
  const fields: Record<string, string> = {};
  for (const p of parts) if (p.filename === null && p.name !== 'file') fields[p.name.toLowerCase()] = new TextDecoder().decode(p.body);
  const files = parts.filter((p) => p.name === 'file');
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "InvalidArgument"
  if (files.length !== 1) return s3Error(ctx, 400, 'InvalidArgument', 'POST requires exactly one file upload per request.', { ArgumentName: 'file', ArgumentValue: String(files.length) });
  const file = files[0]!;
  const key = fields.key ?? '';
  const asset = ctx.row(ASSET, key);
  const policyText = fields.policy ?? '';
  let policy: { expiration?: string; conditions?: Array<unknown> } = {};
  try { policy = JSON.parse(atob(policyText)) as typeof policy; } catch { policy = {}; }
  // the policy is the lease's: signed with the World's key, as S3 checks a POST's signature over its policy
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "SignatureDoesNotMatch"
  const signed = Boolean(asset && asset.bucket === bucket && policyText && fields['x-amz-signature'] === ctx.crypto.hmac(await ctx.secret('s3-signing-key'), policyText, 'hex'));
  if (!signed || !asset) return unsigned(ctx);
  // Where the documentation stops: S3's words for a policy refused (AccessDenied, "Invalid according to Policy: …") are
  // the error AWS's error list names for access refused, with the reason S3 gives
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "AccessDenied"
  if (!policy.expiration || Date.parse(policy.expiration) / 1000 < nowSeconds(ctx)) return s3Error(ctx, 403, 'AccessDenied', 'Invalid according to Policy: Policy expired.');
  // every field the form carries is one a condition covers, but the policy and its signature themselves, the file, and
  // a field named x-ignore-*: S3 refuses any other as an extra input field
  const covered = new Set((policy.conditions ?? []).flatMap((c) => (Array.isArray(c) ? [String(c[1]).replace(/^\$/, '').toLowerCase()] : c && typeof c === 'object' ? Object.keys(c).map((k) => k.toLowerCase()) : [])));
  const extra = Object.keys(fields).find((name) => !covered.has(name) && !['policy', 'x-amz-signature'].includes(name) && !name.startsWith('x-ignore-'));
  if (extra) return extraField(ctx, extra);
  for (const c of policy.conditions ?? []) {
    if (!Array.isArray(c) || c[0] !== 'eq') continue;
    const name = String(c[1]).replace(/^\$/, '').toLowerCase();
    const given = name === 'bucket' ? (fields.bucket ?? bucket) : fields[name];
    if (given !== String(c[2])) return s3Error(ctx, 403, 'AccessDenied', `Invalid according to Policy: Policy Condition failed: ["eq", "$${String(c[1]).replace(/^\$/, '')}", "${String(c[2])}"]`);
  }
  const range = (policy.conditions ?? []).find((c): c is [string, number, number] => Array.isArray(c) && c[0] === 'content-length-range');
  const size = file.body.byteLength;
  if (range && size > Number(range[2])) {
    // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "Your proposed upload exceeds the maximum allowed object size."
    // the answer PRAW reads its maximum from (Code, Message, ProposedSize, MaxSizeAllowed, as its test of a large image shows)
    // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/models/reddit/test_subreddit.py "Your proposed upload exceeds the maximum allowed size"
    return s3Error(ctx, 400, 'EntityTooLarge', 'Your proposed upload exceeds the maximum allowed size', { ProposedSize: size, MaxSizeAllowed: Number(range[2]) });
  }
  // source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "Your proposed upload is smaller than the minimum allowed"
  if (range && size < Number(range[1])) return s3Error(ctx, 400, 'EntityTooSmall', 'Your proposed upload is smaller than the minimum allowed size', { ProposedSize: size, MinSizeAllowed: Number(range[1]) });
  // the file arrives: the lease's move, a person's (or a program's) act on the bucket, outside Reddit's API
  const refused = ctx.legal(ASSET, '_uploaded', 'uploads', asset._uploaded, 'true', key, 'external');
  if (refused) return s3Error(ctx, 403, 'AccessDenied', refused.message);
  const etag = s3.md5Etag(file.body);
  await ctx.blobs.put(`asset:${key}`, file.body);
  await ctx.write(ASSET, key, { _uploaded: true, size, etag, uploaded_utc: nowSeconds(ctx), ...mediaFacts(file.body, String(asset.mimetype)) }, 'asset.upload');
  const location = `https://${bucketHost(bucket)}/${key}`;
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_image__selftext.json "PostResponse"
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<PostResponse>${s3.x('Location', location)}${s3.x('Bucket', bucket)}${s3.x('Key', key)}${s3.x('ETag', etag)}</PostResponse>`;
  return new Response(xml, { status: 201, headers: { 'content-type': 'application/xml', location, etag, ...CORS } });
}
