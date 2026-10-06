// A user's API tokens: the verify a client sends to test the token it holds (Open Autonomy's setup, before it keeps one).
import type { HandlerContext } from '@volter/world-core';
import { apiError, apiOk, bearerToken, tokenLive } from './shared.ts';

/** `GET /user/tokens/verify`: the token the request carries, its id and status (and its window when it has one). A token
 *  the World does not hold, or a disabled or expired one, is refused before this (the manifest's `auth`, around.ts). */
// source: spec:user-api-tokens-verify-token "Test whether a token works."
export async function user_api_tokens_verify_token(ctx: HandlerContext): Promise<Response> {
  const caller = bearerToken(ctx);
  if (!tokenLive(caller, ctx.occurredAt)) return apiError(401, 10000, 'Authentication error');
  // an account's token is verified at its account (account-api-tokens-verify-token), not as a user's. Where the
  // documentation stops: the answer to an account token at the user's verify is not recorded; it takes the API's
  // authentication error
  if (caller._kind === 'account') return apiError(403, 10000, 'Authentication error');
  const own = ctx.own(caller);
  return apiOk({ id: own.id, status: caller.status,
    ...(typeof caller.not_before === 'string' ? { not_before: caller.not_before } : {}),
    ...(typeof caller.expires_on === 'string' ? { expires_on: caller.expires_on } : {}) });
}
