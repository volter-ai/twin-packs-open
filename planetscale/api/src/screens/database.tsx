// PLANETSCALE'S DATABASE PAGE — app.planetscale.com/{organization}/{database}: its branches, the production branch's
// Connect (Create password: a name and a role; its username and password shown once, with the host,
// https://planetscale.com/docs/vitess/connecting/connection-strings), and Delete database, which asks for its name ("Remove all
// data and backups permanently"). A password is made once the database is ready. A workspace (docs/contributing/
// architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, signedIn } from '@volter/world-ui';
import { BACKUP, BRANCH, branchOf, DATABASE, databaseOf, makePassword, PASSWORD, ROW_TYPES } from '../semantics/shared.ts';
import { adminOf, COOKIE, notAllowed, notFound, type Row, SKIN, toLogin } from './shared.tsx';

// source: https://planetscale.com/docs/vitess/security/password-roles "Can query and modify rows"
const ROLES = [{ value: 'reader', label: 'Read-only' }, { value: 'writer', label: 'Write-only' }, { value: 'readwriter', label: 'Read/Write' }, { value: 'admin', label: 'Admin' }];

// The forms' ?do= action names are the twin's own (where the evidence stops: PlanetScale's dashboard routes are not
// documented); no dashboard form submits an action outside its declared controls.
function unknownAction(ctx: HandlerContext, org: Row, db: Row): Response {
  return page(ctx, org, db, 'Choose an action.', 422);
}

function page(ctx: HandlerContext, org: Row, db: Row, notice?: string, status = 200): Response {
  const base = `/${String(org.name)}/${String(db.name)}`;
  const passwords = ctx.rowsRaw(PASSWORD).filter((p) => p.database === db.id && p.deleted !== true);
  const branches = ctx.rowsRaw(BRANCH).filter((b) => b._database === db.id && b.deleted !== true);
  return flowPage({
    title: `${String(db.name)} | PlanetScale`, css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(org.name)} · ${String(db.name)}`}
        back={{ href: `/${String(org.name)}`, label: 'Databases' }}
        {...(notice ? { notice } : {})}
        sections={[
          { heading: 'Branches', empty: 'No branches.', items: branches.map((b) => ({ title: String(b.name), badge: b.production === true ? 'Production' : 'Development', detail: db.ready === true ? 'Ready' : 'Initializing' })) },
          { heading: 'Passwords', empty: 'No passwords yet.', items: passwords.map((p) => ({ title: String(p.name), badge: String(p.role), detail: `${String(p.username)} · ${String(p.access_host_url)}` })) },
        ]}
        forms={[
          { heading: 'Connect: Create password', action: `${base}?do=password`, fields: [{ id: 'name', label: 'Name' }, { id: 'role', label: 'Role', options: ROLES }], submit: { label: 'Create password' } },
          { heading: 'Delete database', action: `${base}?do=delete`, fields: [{ id: 'confirm', label: `Type ${String(db.name)} to confirm` }], submit: { label: 'Delete database' } },
        ]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const orgName = String(ctx.call.params.organization ?? '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(`/${orgName}/${String(ctx.call.params.database ?? '')}`);
  const org = adminOf(ctx, person, orgName);
  const db = org ? databaseOf(ctx, org, String(ctx.call.params.database ?? '')) : undefined;
  if (!org || !db) return notFound();
  if (request.method === 'GET') return page(ctx, org, db);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const act = new URL(request.url).searchParams.get('do');
  if (act !== 'password' && act !== 'delete') return unknownAction(ctx, org, db);
  if (act === 'password') {
    if (db.ready !== true) return page(ctx, org, db, 'The database is still initializing.', 409);
    const name = (f.name ?? '').trim();
    if (!name || !ROLES.some((r) => r.value === f.role)) return page(ctx, org, db, 'A password needs a name and a role.', 422);
    const { row, secret } = await makePassword(ctx, db, branchOf(ctx, db, 'main')!, { name, role: f.role!, by: String(person.email) });
    return page(ctx, org, db, `Password ${name} created. Host: ${String(row.access_host_url)} · Username: ${String(row.username)} · Password: ${secret} — copy it now: it will not be shown again.`, 201);
  }
  if ((f.confirm ?? '').trim() !== db.name) return page(ctx, org, db, 'Type the database name to confirm.', 422);
  // "Remove all data and backups permanently": its branches, passwords, backups, tables and rows go with it
  for (const type of [BRANCH, PASSWORD, BACKUP, ...ROW_TYPES]) {
    for (const r of ctx.rowsRaw(type).filter((x) => (x._database === db.id || x.database === db.id) && x.deleted !== true)) await ctx.remove(type, String(r.id), `${type}.delete`);
  }
  await ctx.remove(DATABASE, String(db.id), 'database.delete');
  return new Response(null, { status: 303, headers: { location: `/${String(org.name)}` } });
}
