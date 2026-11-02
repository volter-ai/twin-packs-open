// PLANETSCALE'S ORGANIZATION PAGE — app.planetscale.com/{organization}: its databases, and New database (a name, a
// region, a cluster size; https://planetscale.com/docs/vitess/tutorials/planetscale-quick-start-guide, "Create a
// database"). A new database is initializing for a minute (the api lane's clock). Where the documentation stops: the
// regions and sizes offered are a few of PlanetScale's. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, redirect, signedIn } from '@volter/world-ui';
import { DATABASE, makeDatabase } from '../semantics/shared.ts';
import { adminOf, COOKIE, notAllowed, notFound, type Row, SKIN, toLogin } from './shared.tsx';

const REGIONS = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-southeast'];
const SIZES = ['PS_10', 'PS_20', 'PS_40', 'PS_80'];

function page(ctx: HandlerContext, person: Row, org: Row, notice?: string, status = 200): Response {
  const dbs = ctx.rowsRaw(DATABASE).filter((d) => d._organization === org.id && d.deleted !== true);
  return flowPage({
    title: `${String(org.name)} | PlanetScale`, css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(org.name)} · Databases`}
        back={{ href: `/${String(org.name)}/settings/service-tokens`, label: 'Settings · Service tokens' }}
        {...(notice ? { notice } : {})}
        sections={[{ heading: 'Databases', empty: 'No databases yet.', items: dbs.map((d) => ({ title: String(d.name), badge: d.ready === true ? 'Ready' : 'Initializing', detail: `${String((d.region as Row).slug)} · ${String(d._cluster)}`, actions: [{ label: 'Open', action: `/${String(org.name)}/${String(d.name)}`, method: 'get' as const }] })) }]}
        forms={[{ heading: 'New database', action: `/${String(org.name)}`, fields: [{ id: 'name', label: 'Database name' }, { id: 'region', label: 'Region', options: REGIONS.map((r) => ({ value: r, label: r })) }, { id: 'cluster', label: 'Cluster size', options: SIZES.map((s) => ({ value: s, label: s })) }], submit: { label: 'Create database' } }]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const name = String(ctx.call.params.organization ?? '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(`/${name}`);
  const org = adminOf(ctx, person, name);
  if (!org) return notFound();
  if (request.method === 'GET') return page(ctx, person, org);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const db = (f.name ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(db)) return page(ctx, person, org, 'A name of lowercase letters, digits and hyphens is required.', 422);
  if (!REGIONS.includes(f.region ?? '') || !SIZES.includes(f.cluster ?? '')) return page(ctx, person, org, 'Choose a region and a cluster size.', 422);
  if (ctx.rowsRaw(DATABASE).some((d) => d._organization === org.id && d.name === db && d.deleted !== true)) return page(ctx, person, org, `A database named ${db} exists.`, 409);
  await makeDatabase(ctx, org, { name: db, region: f.region!, cluster: f.cluster! });
  return redirect(`/${String(org.name)}/${db}`);
}
