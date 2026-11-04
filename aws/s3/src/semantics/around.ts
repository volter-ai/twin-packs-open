// What S3 does around every request (docs/contributing/architecture.md, around.ts): a browser's CORS preflight answered
// by the bucket's CORS rules (PutBucketCors), before any signature; the request's SigV4 signature, verified against the
// access key that signed it and over the bytes it carried (./shared.ts, the vendor's: an issued key, else S3's refusal);
// its body kept as its bytes before the dispatch reads it (the kernel's S3 wire); a cross-origin answer given the headers
// its bucket's matching rule allows. A virtual-hosted request arrives here in its path-style form (the manifest's
// `pathFromHost`), its signature still over the path it sent. No bucket here is public, so an unsigned request is
// refused as S3 refuses an anonymous one on a private bucket.
import { s3, type HandlerContext } from '@volter/world-core';
import { BUCKET, refuse, signedBy } from './shared.ts';

// source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html "The AWS access key ID you provided does not exist in our records."
const REFUSALS = {
  unsigned: { status: 403, code: 'AccessDenied', message: 'Access Denied' },
  malformed: { status: 400, code: 'AuthorizationHeaderMalformed', message: 'The authorization header you provided is not valid.' },
  unknown_key: { status: 403, code: 'InvalidAccessKeyId', message: 'The AWS access key ID you provided does not exist in our records.' },
  bad_signature: { status: 403, code: 'SignatureDoesNotMatch', message: 'The request signature we calculated does not match the signature you provided. Check your key and signing method.' },
  expired: { status: 403, code: 'AccessDenied', message: 'Request has expired' },
} as const;

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  const name = decodeURIComponent(new URL(request.url).pathname.split('/')[1] ?? '');
  const held = name ? ctx.row(BUCKET, name) : undefined;
  const rules = (held && held.deleted !== true ? held._cors ?? [] : []) as s3.CorsRule[];
  const origin = request.headers.get('origin');
  // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html "When Amazon S3 receives a preflight request from a browser, it evaluates the CORS configuration for the bucket and uses the first CORSRule rule that matches the incoming browser request to enable a cross-origin request."
  if (request.method === 'OPTIONS') {
    // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors-troubleshooting.html "CORS Response: CORS is not enabled for this bucket."
    if (!rules.length) return refuse(403, 'AccessForbidden', 'CORS Response: CORS is not enabled for this bucket.');
    const requested = s3.requestedHeaders(request);
    const rule = origin ? s3.corsRuleFor(rules, origin, request.headers.get('access-control-request-method') ?? '', requested) : undefined;
    // source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors-troubleshooting.html "CORS Response: This CORS request is not allowed."
    if (!rule || !origin) return refuse(403, 'AccessForbidden', 'CORS Response: This CORS request is not allowed.');
    return new Response(null, { status: 200, headers: s3.corsHeaders(rule, origin, requested, true) });
  }
  // the payload hash a request declares is checked against the bytes it carried (the kernel's verifySigV4, architecture's
  // AWS-style request signatures)
  const kept = await s3.withBytes(request);
  const verdict = await signedBy(ctx, request, s3.bytesOf(kept));
  if (!verdict.ok) return ctx.refuse(REFUSALS[verdict.reason]);
  const answer = await next(kept);
  const rule = origin ? s3.corsRuleFor(rules, origin, request.method, []) : undefined;
  if (!rule || !origin) return answer;
  const headers = new Headers(answer.headers);
  for (const [k, v] of Object.entries(s3.corsHeaders(rule, origin, [], false))) headers.set(k, v);
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
}
