// Slack's auth.* methods (https://docs.slack.dev/reference/methods?family=auth): who a token is, and revoking it.
import type { HandlerContext } from '@volter/world-core';
import { ok, TOKENS, tokenKey, who } from './shared.ts';

/** auth.test: "Checks authentication & identity": the workspace, the user and, for a bot token, its bot. */
export async function auth_test(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const t = ctx.get('team', by.team);
  const u = ctx.get('user', by.user);
  const domain = String(t?.domain ?? 'twin');
  return ok(ctx, {
    url: `https://${domain}.slack.com/`, team: t?.name ?? '', user: u?.name ?? '', team_id: by.team, user_id: by.user,
    ...(by.bot ? { bot_id: by.bot, app_id: by.app } : {}), is_enterprise_install: false,
  });
}

/** auth.revoke: the calling token is revoked ("test: Setting this parameter to 1 triggers a testing mode where the
 *  specified token will not actually be revoked"). */
export async function auth_revoke(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const test = ctx.params.test === true || ctx.params.test === '1' || ctx.params.test === 'true';
  if (!test && by.kind !== 'person') await ctx.write(TOKENS, tokenKey(by.token), { revoked: true }, 'token.revoke');
  return ok(ctx, { revoked: !test });
}
