// R2 request authorization and CORS, authored from its documented token and S3 wires.
import { verifySigV4, type HandlerContext } from '@volter/world-core';
import { bucketNamed, API_TOKEN, TEMPORARY, BUCKET, DOMAIN, bucketKey, tokenLive, r2Grant, temporaryGrant, hostOf, endpointOf,
  s3, payload, error, denied, unsupported, readObject, r2PublicDomain, preflight, corsAnswer, workerDomainAnswer, type Row } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request; const host = hostOf(request); const endpoint = endpointOf(host);
  if (!endpoint) {
    const worker = await workerDomainAnswer(ctx, host, request);
    if (worker) return worker;
    const domain = r2PublicDomain(ctx, host);
    if (!domain || !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return error('AccessDenied', 'Access Denied', 403);
    const bucket = ctx.row(BUCKET, String(domain._bucket));
    if (!bucket) return error('NoSuchBucket', 'The specified bucket does not exist.', 404);
    const rules = (bucket.cors ?? []) as s3.CorsRule[];
    if (request.method === 'OPTIONS') return preflight(request, rules);
    let key: string; try { key = decodeURIComponent(new URL(request.url).pathname.slice(1)); } catch { return error('InvalidArgument', 'Invalid object key.', 400); }
    return corsAnswer(request, rules, await readObject(ctx, bucket, key, request));
  }
  // source: https://developers.cloudflare.com/r2/buckets/cors/ "When a browser makes a request to a presigned URL on a different origin, the browser enforces CORS."
  // OPTIONS has no S3 operation binding; the kernel still gives it the path's Bucket and Key, and a virtual host names its bucket.
  const name = String(ctx.call.params.Bucket ?? endpoint.bucket ?? '');
  const key = String(ctx.call.params.Key ?? '');
  const bucket = name ? bucketNamed(ctx, endpoint.account, name) : undefined;
  const rules = (bucket?.jurisdiction === endpoint.jurisdiction ? bucket.cors ?? [] : []) as s3.CorsRule[];
  if (request.method === 'OPTIONS') return preflight(request, rules);
  const feature = unsupported(request, ctx.call.operation.id); if (feature) return feature;
  const url = new URL(request.url);
  let credential: Row | undefined; let token: Row | undefined;
  const verdict = await verifySigV4(request, await payload(ctx), async keyId => {
    credential = ctx.row(TEMPORARY, keyId);
    token = ctx.row(API_TOKEN, credential ? String(credential.parent_id) : keyId);
    if (!tokenLive(token, ctx.occurredAt)) return undefined;
    if (credential) {
      const supplied = request.headers.get('x-amz-security-token') ?? url.searchParams.get('X-Amz-Security-Token');
      if (!supplied || !ctx.crypto.equalSecrets(supplied, await ctx.secret(`r2-session:${credential._custody}`))
        || Date.parse(String(credential.expires_at)) <= Date.parse(ctx.occurredAt)) return undefined;
      return ctx.secret(`r2-secret:${credential._custody}`);
    }
    // This selected implementation serves API-issued sessions; an unrecognized session must not become an unrestricted parent key.
    if (request.headers.has('x-amz-security-token') || url.searchParams.has('X-Amz-Security-Token')) return undefined;
    return String(token._sha256);
  }, Date.parse(ctx.occurredAt));
  if (!verdict.ok) return verdict.reason === 'expired' ? error('ExpiredRequest', 'Request has expired.', 403)
    : verdict.reason === 'bad_signature' ? error('SignatureDoesNotMatch', 'The request signature did not match.', 403)
      : error('Unauthorized', 'Missing or invalid authentication credentials.', 401);
  if (verdict.service !== 's3' || !['auto', 'us-east-1', ''].includes(verdict.region)) return error('SignatureDoesNotMatch', 'Invalid credential scope.', 403);
  if (url.searchParams.has('X-Amz-Expires')) {
    const seconds = Number(url.searchParams.get('X-Amz-Expires'));
    // source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/ "1 second to 7 days"
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800) return error('InvalidArgument', 'Invalid presigned expiration.', 400);
  }
  const administrative = ['CreateBucket', 'ListBuckets', 'HeadBucket', 'DeleteBucket', 'GetBucketLocation', 'GetBucketEncryption',
    'GetBucketCors', 'PutBucketCors', 'DeleteBucketCors', 'GetBucketLifecycleConfiguration', 'PutBucketLifecycleConfiguration'].includes(ctx.call.operation.id);
  const mutation = !['GET', 'HEAD'].includes(request.method);
  if (!token || !r2Grant(ctx, token, endpoint.account, endpoint.jurisdiction, name || undefined, mutation, administrative)
    || credential && (administrative && !String(credential.permission).startsWith('admin') || (!['ListObjects', 'ListObjectsV2', 'DeleteObjects', 'ListMultipartUploads'].includes(ctx.call.operation.id) && !temporaryGrant(credential, name, key, mutation, ctx.occurredAt) || credential.bucket !== name))) return denied();
  const answered = await next();
  const result = request.method === 'HEAD' ? new Response(null, { status: answered.status, headers: answered.headers }) : answered;
  return corsAnswer(request, rules, result);
}
