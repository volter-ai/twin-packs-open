import type { HandlerContext } from '@volter/world-core';
import { flowPage, Portal, PORTAL_CSS, formOf } from '@volter/world-ui';
import { at, person, memberships, dashboardToken, shownTokens } from './shared.tsx';
import { sameAccount } from '../semantics/shared.ts';
// source: https://developers.cloudflare.com/r2/api/tokens/ "Create Account API token"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const who = person(ctx); if (who instanceof Response) return who;
  const account = String(ctx.call.params.account_id ?? ''); const members = memberships(ctx, who.email);
  if (!members.some(member => sameAccount(ctx, member.account_id, account))) return new Response('Account access denied.', { status: 403 });
  const path = at(ctx, new URL(ctx.call.request.url).pathname); const form = formOf(ctx); let notice: string | undefined;
  if (ctx.call.request.method === 'POST') {
    const result = await dashboardToken(ctx, who.email, who.id, account, form, []); if (result instanceof Response) return result; notice = result.notice;
  }
  return flowPage({ title: 'R2 API Tokens', css: [PORTAL_CSS], body: <Portal merchant="Cloudflare R2" notice={notice}
    sections={[{ heading: 'R2 API Tokens', empty: 'No tokens.', items: shownTokens(ctx, who.email, account).map(token => ({ title: String(token.name), badge: String(token.status),
      actions: [{ label: 'Roll', action: path, fields: { action: 'roll', token_id: String(token.id) } },
        { label: 'Revoke', action: path, fields: { action: 'delete', token_id: String(token.id) }, tone: 'danger' }] })) }]}
    forms={['account', 'user'].map(kind => ({ heading: `Create ${kind === 'account' ? 'Account' : 'User'} API token`, action: path,
      submit: { label: `Create ${kind === 'account' ? 'Account' : 'User'} API token` }, fields: [
        { id: 'name', label: 'Token name' }, { id: 'token_kind', label: 'Token owner', value: kind, options: [{ value: kind, label: kind }] },
        { id: 'permission', label: 'Permissions', options: [{ value: 'admin-rw', label: 'Admin Read & Write' }, { value: 'admin-ro', label: 'Admin Read only' },
          { value: 'object-rw', label: 'Object Read & Write' }, { value: 'object-ro', label: 'Object Read only' }] },
        { id: 'bucket', label: 'Bucket scope', value: '*' }, { id: 'jurisdiction', label: 'Jurisdiction', value: 'default' },
      ] }))} /> });
}
