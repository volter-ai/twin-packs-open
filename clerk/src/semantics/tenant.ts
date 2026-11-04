import type { HandlerContext } from '@volter/world-core';

/** Dashboard workspaces and applications are shared; each application's instance has its own API store. */
export async function applicationFor(ctx: HandlerContext): Promise<Record<string, unknown>> {
  const organization = await ctx.organization();
  const workspace = await ctx.tenant('_workspace', (owner) => ctx.record('_workspace', { name: owner.label, owner: owner.members[0]!, members: owner.members }));
  return ctx.deploymentObject(`application:${String(workspace.id)}`, '_application', async (deployment) => {
    const application = await ctx.create('_application', { name: deployment || organization.label, workspace_id: workspace.id, owner: organization.members[0]! }, 'application.create');
    return String(application.id);
  });
}

export async function tenant(ctx: HandlerContext): Promise<string | undefined> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const body = ctx.body as Record<string, unknown> | undefined;
  if (url.pathname === '/_twin/app-credentials' || (url.pathname.startsWith('/_twin/') && (body?.account !== undefined || body?.deployment !== undefined))) {
    const application = await applicationFor(ctx);
    return await ctx.account() === 'default' && ctx.deployment() === '' ? 'default' : String(application.id);
  }
  const secret = request.headers.get('Clerk-Secret-Key') ?? request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (secret?.startsWith('sk_')) {
    const key = ctx.rowsRaw('_secret_key').find((row) => row.sha256 === ctx.crypto.sha256(secret));
    return typeof key?._application_scope === 'string' ? key._application_scope : undefined;
  }
  if (url.pathname.startsWith('/_twin/')) return 'default';
  const host = (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? url.hostname).split(':')[0];
  const instance = ctx.rowsRaw('_instance').find((row) => (row._auth as Record<string, unknown> | undefined)?.frontend_api === host);
  if (typeof instance?._application_scope === 'string') return instance._application_scope;
  if (host === 'twin.clerk.accounts.dev' || host === 'frontend-api.clerk.dev' || host === 'api.clerk.com' || host === 'dashboard.clerk.com' || host === 'img.clerk.com') return 'default';
  return undefined;
}
