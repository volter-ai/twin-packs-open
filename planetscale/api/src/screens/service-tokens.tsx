// PLANETSCALE'S SERVICE TOKENS PAGE — app.planetscale.com/{organization}/settings/service-tokens: New service token (a
// name; its id and token shown once), and a token's permissions saved per database ("you may only add service token
// accesses that you are also authorized to do", https://planetscale.com/docs/api/reference/service-tokens). Where the
// documentation stops: the permissions offered are the database accesses a backup and its reading take. A workspace
// (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, signedIn } from '@volter/world-ui';
import { accessesOf, DATABASE, makeServiceToken, SERVICE_TOKEN, TOKEN_ACCESS } from '../semantics/shared.ts';
import { adminOf, COOKIE, notAllowed, notFound, type Row, SKIN, toLogin } from './shared.tsx';

// source: spec:create_backup "write_backups"
const ACCESSES = ['write_backups', 'read_backups'];

// The forms' ?do= action names are the twin's own (where the evidence stops: PlanetScale's dashboard routes are not
// documented); no dashboard form submits an action outside its declared controls.
function unknownAction(ctx: HandlerContext, org: Row): Response {
  return page(ctx, org, 'Choose an action.', 422);
}

function page(ctx: HandlerContext, org: Row, notice?: string, status = 200): Response {
  const base = `/${String(org.name)}/settings/service-tokens`;
  const tokens = ctx.rowsRaw(SERVICE_TOKEN).filter((t) => t._organization === org.id && t.deleted !== true);
  const dbs = ctx.rowsRaw(DATABASE).filter((d) => d._organization === org.id && d.deleted !== true);
  return flowPage({
    title: 'Service tokens | PlanetScale', css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(org.name)} · Service tokens`}
        back={{ href: `/${String(org.name)}`, label: 'Databases' }}
        {...(notice ? { notice } : {})}
        sections={[{ heading: 'Service tokens', empty: 'No service tokens yet.', items: tokens.map((t) => ({ title: String(t.name), detail: `${String(t.id)} · ${accessesOf(ctx, t).map((a) => `${String(a.access)} on ${String((a.resource as Row).name)}`).join(', ') || 'no permissions'}` })) }]}
        forms={[
          { heading: 'New service token', action: `${base}?do=new`, fields: [{ id: 'name', label: 'Name' }], submit: { label: 'Create service token' } },
          { heading: 'Save permissions', action: `${base}?do=access`, fields: [{ id: 'token', label: 'Service token', options: tokens.map((t) => ({ value: String(t.id), label: String(t.name) })) }, { id: 'database', label: 'Database', options: dbs.map((d) => ({ value: String(d.name), label: String(d.name) })) }, { id: 'access', label: 'Permission', options: ACCESSES.map((a) => ({ value: a, label: a })) }], submit: { label: 'Save permissions' } },
        ]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const orgName = String(ctx.call.params.organization ?? '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(`/${orgName}/settings/service-tokens`);
  const org = adminOf(ctx, person, orgName);
  if (!org) return notFound();
  if (request.method === 'GET') return page(ctx, org);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const act = new URL(request.url).searchParams.get('do');
  if (act !== 'new' && act !== 'access') return unknownAction(ctx, org);
  if (act === 'new') {
    const name = (f.name ?? '').trim();
    if (!name) return page(ctx, org, 'A service token needs a name.', 422);
    const { row, token } = await makeServiceToken(ctx, org, name);
    return page(ctx, org, `Service token ${name} created. ID: ${String(row.id)} · Token: ${token} — copy it now: it will not be shown again.`, 201);
  }
  const t = ctx.rowsRaw(SERVICE_TOKEN).find((x) => x.id === f.token && x._organization === org.id && x.deleted !== true);
  const db = ctx.rowsRaw(DATABASE).find((d) => d._organization === org.id && d.name === f.database && d.deleted !== true);
  if (!t || !db || !ACCESSES.includes(f.access ?? '')) return page(ctx, org, 'Choose a token, a database and a permission.', 422);
  const key = `${String(t.id)}::${String(db.id)}::${f.access!}`;
  if (!ctx.rowsRaw(TOKEN_ACCESS).some((a) => a.id === key && a.deleted !== true)) {
    await ctx.record(TOKEN_ACCESS, { access: f.access, resource_name: db.name, _token: t.id, _database: db.id, deleted: false }, key);
  }
  return page(ctx, org, `Permissions saved: ${f.access!} on ${String(db.name)} for ${String(t.name)}.`);
}
