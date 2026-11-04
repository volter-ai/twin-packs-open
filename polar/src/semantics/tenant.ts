// Native credentials, customer sessions and checkout secrets select their organization before data access.
import type { HandlerContext } from '@volter/world-core';
import { accessToken, nativeOrganization, settingsOrganization } from './shared.ts';

export async function tenant(ctx: HandlerContext): Promise<string> {
  const request = ctx.call.request, url = new URL(request.url);
  if (url.pathname.startsWith('/_twin/')) {
    const organization = url.pathname === '/_twin/app-credentials' ? await nativeOrganization(ctx) : await settingsOrganization(ctx);
    return String(organization?._namespace ?? '__unselected__');
  }
  const bearer = /^Bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (bearer) {
    const key = accessToken(ctx, bearer);
    const session = ctx.rowsRaw('customer_session').find((row) => row.token === bearer);
    return String(key?._organization_namespace ?? session?._organization_namespace ?? '__unselected__');
  }
  const token = url.searchParams.get('customer_session_token');
  if (token) return String(ctx.rowsRaw('customer_session').find((row) => row.token === token)?._organization_namespace ?? '__unselected__');
  const secret = ctx.call.params.client_secret;
  if (secret) return String(ctx.rowsRaw('Checkout').find((row) => row.client_secret === secret)?._organization_namespace ?? '__unselected__');
  return 'default';
}
