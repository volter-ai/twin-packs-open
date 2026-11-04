// What Secrets Manager does around every request (docs/contributing/architecture.md, around.ts): the request's SigV4
// signature, verified against the access key that signed it (./shared.ts, the vendor's: an issued key, else the
// refusal AWS's JSON protocol answers, https://docs.aws.amazon.com/secretsmanager/latest/apireference/CommonErrors.html).
// A JSON 1.1 request sends no payload-hash header, so its body's bytes are hashed as it arrived.
import type { HandlerContext } from '@volter/world-core';
import { signedBy } from './shared.ts';

// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-troubleshooting.html "The request signature we calculated does not match the signature you provided"
const REFUSALS = {
  unsigned: { status: 400, code: 'MissingAuthenticationTokenException', message: 'Missing Authentication Token' },
  malformed: { status: 400, code: 'IncompleteSignatureException', message: 'The request signature does not conform to AWS standards.' },
  unknown_key: { status: 403, code: 'UnrecognizedClientException', message: 'The security token included in the request is invalid.' },
  bad_signature: { status: 403, code: 'InvalidSignatureException', message: 'The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method. Consult the service documentation for details.' },
  expired: { status: 400, code: 'ExpiredTokenException', message: 'The security token included in the request is expired' },
} as const;

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const verdict = await signedBy(ctx, ctx.call.request, ctx.text);
  if (!verdict.ok) return ctx.refuse(REFUSALS[verdict.reason]);
  return next();
}
