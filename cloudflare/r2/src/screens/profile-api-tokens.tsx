import type { HandlerContext } from '@volter/world-core';
import { flowPage, Portal, PORTAL_CSS, formOf } from '@volter/world-ui';
import { at, person, memberships, dashboardToken, shownTokens } from './shared.tsx';
// source: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ "Create Token"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const who = person(ctx); if (who instanceof Response) return who;
  const url = new URL(ctx.call.request.url); const form = formOf(ctx); const accounts = memberships(ctx, who.email);
  // a template URL pre-fills the form: a URL-encoded JSON array of { key, type }, type read or edit (Write)
  // source: https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/ "URL-encoded JSON array of permission objects"
  let keys: Array<{ key?: unknown; type?: unknown }> = [];
  try { const parsed = JSON.parse(url.searchParams.get('permissionGroupKeys') ?? '[]') as unknown; if (Array.isArray(parsed)) keys = parsed as typeof keys; } catch { keys = []; }
  // Where the documentation stops: a key the twin does not know pre-fills nothing (the person chooses on the form)
  const nouns: Record<string, string> = { workers_scripts: 'Workers Scripts', account_settings: 'Account Settings', user_details: 'User Details',
    workers_r2: 'Workers R2 Storage', account_api_tokens: 'Account API Tokens', dns: 'DNS', zone: 'Zone', ssl_and_certificates: 'SSL and Certificates' };
  const selected = keys.map(k => typeof k.key === 'string' && nouns[k.key] && (k.type === 'read' || k.type === 'edit') ? `${nouns[k.key]} ${k.type === 'edit' ? 'Write' : 'Read'}` : undefined)
    .filter((name): name is string => !!name);
  let notice: string | undefined;
  if (ctx.call.request.method === 'POST') {
    const result = await dashboardToken(ctx, who.email, who.id, undefined, form, selected);
    if (result instanceof Response) return result; notice = result.notice;
  }
  return flowPage({ title: 'Cloudflare API Tokens', css: [PORTAL_CSS], body: <Portal merchant="Cloudflare" notice={notice}
    sections={[{ heading: 'API Tokens', empty: 'No tokens.', items: shownTokens(ctx, who.email).map(token => ({ title: String(token.name), badge: String(token.status),
      actions: [{ label: 'Roll', action: at(ctx, url.pathname + url.search), fields: { action: 'roll', token_id: String(token.id) } },
        { label: 'Delete', action: at(ctx, url.pathname + url.search), fields: { action: 'delete', token_id: String(token.id) }, tone: 'danger' }] })) }]}
    forms={[{ heading: 'Create API Token', action: at(ctx, url.pathname + url.search), submit: { label: 'Create Token' }, fields: [
      { id: 'name', label: 'Token name', value: url.searchParams.get('name') ?? '' },
      { id: 'account_id', label: 'Account', options: accounts.map(member => ({ value: String(member.account_id), label: String((member.account as Record<string, unknown>).name) })) },
      { id: 'groups', label: 'Permission groups', value: selected.join(',') },
    ] }]} /> });
}
