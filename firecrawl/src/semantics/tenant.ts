import type { HandlerContext } from '@volter/world-core';

export function accountFor(ctx: HandlerContext): Promise<Record<string, unknown>> {
  return ctx.tenant('_team', (organization) => ctx.record('_team', { name: organization.label, owner: organization.members[0]!, members: organization.members }));
}

export async function tenant(ctx: HandlerContext): Promise<string | undefined> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const body = ctx.body as Record<string, unknown> | undefined;
  if (url.pathname === '/_twin/app-credentials' || (url.pathname.startsWith('/_twin/') && (body?.account !== undefined || body?.deployment !== undefined))) {
    const owner = await accountFor(ctx);
    return await ctx.account() === 'default' ? 'default' : String(owner.id);
  }
  const value = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (value) {
    const key = ctx.rowsRaw('_api_key').find((row) => row.sha256 === ctx.crypto.sha256(value));
    return typeof key?._tenant_scope === 'string' ? key._tenant_scope : undefined;
  }
  return url.pathname.startsWith('/_twin/') ? 'default' : undefined;
}
