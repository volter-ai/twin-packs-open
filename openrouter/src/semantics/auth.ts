// OAuth PKCE's exchange (spec: exchangeAuthCodeForAPIKey; docs/guides/overview/auth/oauth): the code a person's approval
// on the /auth page sent back, exchanged for a key of that person's, checked against the challenge it was asked with.
import type { HandlerContext } from '@volter/world-core';
import { CODE, KEY, makeKey, readKey, orError, sha256, type Row } from './shared.ts';

// source: https://openrouter.ai/docs/guides/overview/auth/oauth "Authorization codes expire 10 minutes after issuance."
const TEN_MINUTES = 10 * 60 * 1000;

// source: spec:exchangeAuthCodeForAPIKey "Exchange an authorization code from the PKCE flow for a user-controlled API key"
export async function exchangeAuthCodeForAPIKey(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  const held = typeof b.code === 'string' ? ctx.row(CODE, sha256(ctx, b.code)) : undefined;
  // source: https://openrouter.ai/docs/guides/overview/auth/oauth "403 Invalid code or code_verifier"
  if (!held || held.deleted === true) return orError(403, 'Invalid code or code_verifier');
  const refusal = held.status === 'used' ? ctx.legal(CODE, 'status', 'exchangeAuthCodeForAPIKey', 'used', undefined, String(held.id)) : undefined;
  if (refusal) return ctx.refuse(refusal);
  if (Date.parse(ctx.occurredAt) - Date.parse(String(held.issued)) >= TEN_MINUTES) return orError(403, 'Authorization code expired');
  const method = typeof b.code_challenge_method === 'string' ? b.code_challenge_method : held.challenge ? 'plain' : undefined;
  // source: https://openrouter.ai/docs/guides/overview/auth/oauth "400 Invalid code_challenge_method"
  if ((method !== undefined && method !== 'plain' && method !== 'S256') || (held.challenge && method !== held.method)) return orError(400, 'Invalid code_challenge_method');
  if (held.challenge) {
    const verifier = String(b.code_verifier ?? '');
    const derived = method === 'S256' ? ctx.crypto.digest('sha256', verifier, 'base64url') : verifier;
    if (!verifier || derived !== held.challenge) return orError(403, 'Invalid code or code_verifier');
  }
  ctx.legal(CODE, 'status', 'exchangeAuthCodeForAPIKey', String(held.status), 'used', String(held.id));
  await ctx.write(CODE, String(held.id), { status: 'used' }, 'exchangeAuthCodeForAPIKey');
  const id = await makeKey(ctx, String(held.user), String(held.key_label ?? 'OAuth'));
  return Response.json({ key: await readKey(ctx, ctx.row(KEY, id)!), user_id: held.user });
}
