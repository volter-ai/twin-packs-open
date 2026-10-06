// Slack's tooling.* methods (https://docs.slack.dev/reference/methods/tooling.tokens.rotate).
import type { HandlerContext } from '@volter/world-core';
import { arg, fail, issueConfigTokens, ok, TOKENS, tokenKey } from './shared.ts';

/** tooling.tokens.rotate: "Exchanges a refresh token for a new app configuration token" — the refresh token spent
 *  ("invalid_refresh_token" for one unknown or spent), the pair it made revoked, and a new pair answered. */
export async function tooling_tokens_rotate(ctx: HandlerContext): Promise<Response> {
  const refresh = arg(ctx, 'refresh_token');
  const kept = refresh ? ctx.row(TOKENS, tokenKey(refresh)) : undefined;
  if (!kept || kept.kind !== 'refresh' || kept.revoked === true) return fail(ctx, 'invalid_refresh_token');
  await ctx.write(TOKENS, tokenKey(String(refresh)), { revoked: true }, 'token.rotate');
  if (typeof kept.pairs === 'string' && ctx.row(TOKENS, kept.pairs)) await ctx.write(TOKENS, kept.pairs, { revoked: true }, 'token.rotate');
  const next = await issueConfigTokens(ctx, String(kept.user), String(kept.team));
  return ok(ctx, { token: next.token, refresh_token: next.refresh_token, team_id: kept.team, user_id: kept.user, iat: next.iat, exp: next.exp });
}
