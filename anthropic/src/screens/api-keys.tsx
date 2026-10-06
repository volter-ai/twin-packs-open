// THE CONSOLE'S API KEYS — platform.claude.com/settings/keys: "click **Create key**. Name the key and choose an
// expiration" (a preset of 3 hours, 1 day, 7 days or 30 days, or Never); the key is shown once. Each key's row can
// Disable it (reversible, Re-enable) or Delete it (permanent). Every key made here acts in the organization's Default
// workspace (https://platform.claude.com/docs/en/manage-claude/authentication). Where the documentation stops: a custom
// duration and the linked account are not offered (no application's key needs them), and the page's words are the
// twin's. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, signedIn } from '@volter/world-ui';
import { KEY, keyValue, WORKSPACE } from '../semantics/shared.ts';
import { COOKIE, notAllowed, type Row, SKIN, toLogin } from './shared.tsx';

// source: https://platform.claude.com/docs/en/manage-claude/authentication "a preset (3 hours, 1 day, 7 days, or 30 days), a custom duration, or Never"
const EXPIRATIONS: Record<string, number | null> = { Never: null, '3 hours': 3 * 3_600_000, '1 day': 86_400_000, '7 days': 7 * 86_400_000, '30 days': 30 * 86_400_000 };

function page(ctx: HandlerContext, person: Row, notice?: string, status = 200): Response {
  const keys = ctx.rowsRaw(KEY).filter((k) => k._organization === person.organization && k.status !== 'archived' && k.deleted !== true);
  return flowPage({
    title: 'API keys | Claude Console', css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(person.email)} · API keys`}
        {...(notice ? { notice } : {})}
        sections={[{
          heading: 'API keys', empty: 'No API keys yet.',
          items: keys.map((k) => ({
            title: String(k.name), detail: `${String(k.hint)} · ${k.status === 'active' ? 'Active' : 'Disabled'} · ${k.expires_at ? `expires ${String(k.expires_at).slice(0, 16)}` : 'never expires'}`,
            actions: [
              k.status === 'active' ? { label: 'Disable', action: '/settings/keys?do=disable', fields: { key: String(k.id) } } : { label: 'Re-enable', action: '/settings/keys?do=enable', fields: { key: String(k.id) } },
              { label: 'Delete', action: '/settings/keys?do=delete', fields: { key: String(k.id) }, tone: 'danger' as const },
            ],
          })),
        }]}
        forms={[{ heading: 'Create key', action: '/settings/keys?do=create', fields: [{ id: 'name', label: 'Name' }, { id: 'expiration', label: 'Expiration', options: Object.keys(EXPIRATIONS).map((e) => ({ value: e, label: e })) }], submit: { label: 'Create key' } }]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin('/settings/keys');
  if (request.method === 'GET') return page(ctx, person);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const act = new URL(request.url).searchParams.get('do');
  if (act === 'disable' || act === 'enable' || act === 'delete') {
    const k = ctx.rowsRaw(KEY).find((x) => x.id === f.key && x._organization === person.organization && x.status !== 'archived');
    if (!k) return page(ctx, person, 'Choose a key of this organization.', 422);
    const to = act === 'disable' ? 'inactive' : act === 'enable' ? 'active' : 'archived';
    const refused = ctx.legal(KEY, 'status', `api_key.${act}`, k.status, to, String(k.id), 'external');
    if (refused) return page(ctx, person, refused.message, 422);
    await ctx.write(KEY, String(k.id), { status: to }, `api_key.${act}`);
    return page(ctx, person, `Key ${String(k.name)} ${act === 'disable' ? 'disabled' : act === 'enable' ? 're-enabled' : 'deleted'}.`);
  }
  const name = (f.name ?? '').trim();
  const lifetime = EXPIRATIONS[f.expiration ?? ''];
  if (!name || lifetime === undefined) return page(ctx, person, 'A key needs a name and an expiration.', 422);
  const workspace = ctx.rowsRaw(WORKSPACE).find((w) => w.organization === person.organization && w.name === 'Default' && w.deleted !== true);
  if (!workspace) return page(ctx, person, 'This organization has no Default workspace.', 422);
  const id = `apikey_01${ctx.mint(KEY)}`;
  const value = await keyValue(ctx, id);
  await ctx.write(KEY, id, {
    name, workspace: workspace.id, _organization: person.organization, created_by: person.email, created_at: ctx.occurredAt, hint: `${value.slice(0, 14)}...${value.slice(-4)}`,
    _sha256: ctx.crypto.sha256(value), expires_at: lifetime === null ? null : new Date(Date.parse(ctx.occurredAt) + lifetime).toISOString(), status: 'active', deleted: false,
  }, 'api_key.create');
  return page(ctx, person, `Key ${name} created: ${value} — save it now; you won't be able to see it again.`, 201);
}
