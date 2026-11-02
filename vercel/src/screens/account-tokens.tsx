// VERCEL'S ACCOUNT TOKENS — vercel.com/account/tokens: Create (a name, a scope, an expiration), "A token's value appears
// only once, at creation", and Delete (https://vercel.com/docs/accounts/access-tokens). A token scoped to a team acts in
// it. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, signedIn } from '@volter/world-ui';
import { TOKEN } from '../semantics/shared.ts';
import { COOKIE, notAllowed, type Row, SKIN, teamsOf, toLogin } from './shared.tsx';

// source: https://vercel.com/docs/accounts/access-tokens "A token's value appears only once, at creation"
const EXPIRATIONS: Record<string, number> = { '1 day': 1, '7 days': 7, '30 days': 30, '60 days': 60, '90 days': 90, '180 days': 180, '1 year': 365 };

function page(ctx: HandlerContext, person: Row, notice?: string, status = 200): Response {
  const mine = ctx.rowsRaw(TOKEN).filter((t) => t._owner === person.email && t.deleted !== true);
  const teams = teamsOf(ctx, person);
  return flowPage({
    title: 'Tokens | Vercel', css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(person.email)} · Account Tokens`}
        {...(notice ? { notice } : {})}
        sections={[{ heading: 'Tokens', empty: 'No tokens yet.', items: mine.map((t) => ({ title: String(t.name), detail: `${String(t._teamSlug)} · expires ${new Date(Number(t.expiresAt)).toISOString().slice(0, 10)}`, actions: [{ label: 'Delete', action: '/account/tokens?do=delete', fields: { token: String(t.id) }, tone: 'danger' as const }] })) }]}
        forms={[{ heading: 'Create Token', action: '/account/tokens?do=create', fields: [{ id: 'name', label: 'Token Name' }, { id: 'scope', label: 'Scope', options: teams.map((t) => ({ value: String(t.slug), label: String(t.slug) })) }, { id: 'expiration', label: 'Expiration', options: Object.keys(EXPIRATIONS).map((e) => ({ value: e, label: e })) }], submit: { label: 'Create' } }]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin('/account/tokens');
  if (request.method === 'GET') return page(ctx, person);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const act = new URL(request.url).searchParams.get('do');
  if (act === 'delete') {
    const t = ctx.rowsRaw(TOKEN).find((x) => x.id === f.token && x._owner === person.email && x.deleted !== true);
    if (!t) return page(ctx, person, 'Choose a token of yours.', 422);
    await ctx.remove(TOKEN, String(t.id), 'token.delete');
    return page(ctx, person, `Token ${String(t.name)} deleted.`);
  }
  const name = (f.name ?? '').trim();
  const team = teamsOf(ctx, person).find((t) => t.slug === f.scope);
  const days = EXPIRATIONS[f.expiration ?? ''];
  if (!name || !team || days === undefined) return page(ctx, person, 'A token needs a name, a scope and an expiration.', 422);
  const id = ctx.mint('_token');
  const value = (await ctx.secret(`vercel-token:${id}`)).replace(/[-_]/g, '').slice(0, 24);
  await ctx.record(TOKEN, { name, _owner: person.email, _team: team.id, _teamSlug: team.slug, _sha256: ctx.crypto.sha256(value), createdAt: Date.parse(ctx.occurredAt), expiresAt: Date.parse(ctx.occurredAt) + days * 86_400_000, deleted: false }, id);
  return page(ctx, person, `Token ${name} created: ${value} — copy it now; it will not be shown again.`, 201);
}
