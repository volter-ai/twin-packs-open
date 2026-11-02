// A backend secret or the instance's own Frontend API hostname chooses the Clerk instance.
import { isWorldAccountName, type HandlerContext } from '@volter/world-core';
export function tenant(ctx: HandlerContext): string | undefined {
  const request = ctx.call.request, url = new URL(request.url);
  if (url.pathname.startsWith('/_twin/')) {
    const name = (ctx.body as Record<string, unknown> | undefined)?.account ?? 'default';
    return isWorldAccountName(name) ? name : undefined;
  }
  const secret = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (secret?.startsWith('sk_')) return ctx.rowsRaw('_secret_key').find(row => row.deleted !== true && row.sha256 === ctx.crypto.sha256(secret))?._world_account as string | undefined;
  const host = request.headers.get('x-volter-world-site') ?? url.hostname;
  const instance = ctx.rowsRaw('_instance').find(row => (row._auth as Record<string, unknown> | undefined)?.frontend_api === host);
  if (instance) return instance._world_account as string;
  if (host === 'twin.clerk.accounts.dev' || host === 'frontend-api.clerk.dev' || host === 'api.clerk.com') return 'default';
  return undefined;
}
