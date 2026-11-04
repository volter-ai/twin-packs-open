import type { HandlerContext } from '@volter/world-core';
import { account } from './shared.ts';

// source: spec:getPlatformLimits "platform limits and counts"
// Where the documentation stops: these are synthetic account limits, never asserted to be the live account's quota.
export async function getPlatformLimits(ctx: HandlerContext): Promise<Response> {
  const paths = ctx.params.path === undefined ? ['/groups/{group_guid}/bitlinks', '/groups', '/groups/{group_guid}/tags', '/bitlinks/{bitlink}'] : [String(ctx.params.path)];
  return Response.json({ platform_limits: paths
    .map(endpoint => ({ endpoint, methods: [{ name: 'GET', limit: 30, count: 0 }] })) });
}

// source: spec:getUser "Returns information for the current authenticated user"
export async function getUser(ctx: HandlerContext): Promise<Response> {
  const login = account(ctx);
  const person = ctx.rowsRaw('_person').find(row => row.login === login);
  const group = ctx.rowsRaw('Group').find(row => row._account === login);
  // Where the documentation stops: the synthetic account fixture is active, has no SSO/2FA and one primary unverified email.
  return Response.json({ login, name: login, default_group_guid: group?.id, is_active: true, is_sso_user: false,
    is_2fa_enabled: false, created: person?.created, modified: person?.modified,
    emails: [{ email: person?.email, is_primary: true, is_verified: false }] });
}
