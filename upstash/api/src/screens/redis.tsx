// UPSTASH'S REDIS PAGES — console.upstash.com/redis: "Create Database", its name and primary region, then the
// database's page with its REST endpoint and tokens, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and "For
// the Read Only token, just enable the Read-Only Token switch" (https://upstash.com/docs/redis/overall/getstarted;
// https://upstash.com/docs/redis/features/restapi). Its Delete asks the database's name to confirm. A person sees the
// databases they made. Where the documentation stops: the regions offered are AWS's the page lists first, the plan is
// the free one, and the confirmation is typing the name. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { formOf, redirect, signedIn } from '@volter/world-ui';
import { DATABASE, makeDatabase } from '../semantics/shared.ts';
import { COOKIE, consolePage, consolePath, notAllowed, type Row, toLogin } from './shared.tsx';

// source: https://upstash.com/docs/redis/overall/getstarted "Create Database"
const REGIONS = ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1', 'sa-east-1'];

function listPage(person: Row, ctx: HandlerContext, notice?: string, status = 200): Response {
  const mine = ctx.rowsRaw(DATABASE).filter((d) => d.user_email === person.email && d.deleted !== true);
  return consolePage(ctx, person, <>
    <div className="up-banner"><div className="up-banner-inner"><div className="up-heading"><h1>Redis</h1><button className="up-primary" type="button" data-open-dialog="create-database">+ Create Database</button></div></div></div>
    <main className="up-main"><nav className="up-tabs" aria-label="Redis navigation"><span aria-current="page">Databases</span></nav>{mine.length ? <><label><span className="up-muted">Search databases</span><br/><input className="up-search" data-database-search placeholder="Search databases"/></label><div className="up-grid">{mine.map(d => <a className="up-database" key={String(d.database_id)} data-database-name={String(d.database_name).toLowerCase()} href={consolePath(ctx, `/redis/${String(d.database_id)}`)}><strong>{String(d.database_name)}</strong><span className="up-muted">{String(d.primary_region)} · Free</span></a>)}</div></> : <section className="up-card"><h2>Create your first database</h2><p className="up-muted">No databases yet.</p><button className="up-primary" type="button" data-open-dialog="create-database">Create Database</button></section>}</main>
    <dialog id="create-database" aria-labelledby="create-title"><h2 id="create-title">Create Database</h2><form method="post" action={consolePath(ctx, '/redis')}><label className="up-field"><span>Database Name</span><input name="name" required pattern="[A-Za-z0-9_-]{1,64}" maxLength={64}/></label><label className="up-field"><span>Primary Region</span><select name="region">{REGIONS.map(region => <option key={region} value={region}>{region}</option>)}</select></label><p className="up-muted">Free · one primary region. Read regions and paid plans are outside this twin’s declared screen scope.</p><div className="up-actions"><button type="button" data-close-dialog>Cancel</button><button className="up-primary" type="submit">Create</button></div></form></dialog>
  </>, notice, status);
}

function databasePage(ctx: HandlerContext, person: Row, d: Row, notice?: string, status = 200): Response {
  const url = `https://${String(d.endpoint)}.upstash.io`;
  return consolePage(ctx, person, <>
    <div className="up-banner"><div className="up-banner-inner"><div className="up-heading"><h1><a href={consolePath(ctx, '/redis')}>Redis</a> / {String(d.database_name)}</h1><a href="https://upstash.com/docs/redis/overall/getstarted">Docs</a></div><div className="up-tags"><span>Free</span><span>AWS</span><span>{String(d.primary_region)}</span></div></div></div>
    <main className="up-main"><nav className="up-tabs" aria-label="Database navigation"><span aria-current="page">Details</span>{['Usage', 'CLI', 'Data Browser', 'Search', 'Monitor', 'Backups', 'ACL'].map(label => <span key={label} aria-disabled="true" title="Outside this twin’s declared screen scope">{label}</span>)}</nav>
      <section className="up-card"><div className="up-connection"><div><small>Endpoint</small><code>{String(d.endpoint)}.upstash.io</code></div><div><small>Token / Readonly Token</small><code>••••••••</code></div><div><small>Port</small><code>6379</code></div><div><small>TLS/SSL</small><span>Enabled</span></div></div></section>
      <section className="up-card"><h2>Connect</h2><p className="up-muted">Connect to your Redis database from your app.</p><div className="up-env"><div className="up-env-header"><span>REST</span><a href="https://upstash.com/docs/redis/features/restapi">REST API documentation</a></div><div className="up-env-row"><label htmlFor="redis-url">UPSTASH_REDIS_REST_URL</label><input id="redis-url" value={url} readOnly/><button type="button" data-copy="redis-url">Copy</button></div><div className="up-env-row"><label htmlFor="redis-token">UPSTASH_REDIS_REST_TOKEN</label><input id="redis-token" type="password" value={String(d.rest_token)} readOnly autoComplete="off"/><button type="button" data-reveal="redis-token">Show</button><button type="button" data-copy="redis-token">Copy</button></div><div className="up-env-row"><label htmlFor="readonly-token">Read-Only Token</label><input id="readonly-token" type="password" value={String(d.read_only_rest_token)} readOnly autoComplete="off"/><button type="button" data-reveal="readonly-token">Show</button><button type="button" data-copy="readonly-token">Copy</button></div></div></section>
      <section className="up-card"><h2>Delete Database</h2><p className="up-muted">This removes the stored database. Type its name to confirm.</p><form method="post" action={consolePath(ctx, `/redis/${String(d.database_id)}/delete`)}><label className="up-field"><span>Type {String(d.database_name)} to confirm</span><input name="confirm" required autoComplete="off"/></label><button className="up-danger" type="submit">Delete</button></form></section>
    </main>
  </>, notice, status);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(path, ctx);
  if (path === '/redis') {
    if (request.method === 'GET') return listPage(person, ctx);
    if (request.method !== 'POST') return notAllowed();
    const f = formOf(ctx);
    const name = (f.name ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return listPage(person, ctx, 'A name of letters, digits, hyphens and underscores is required.', 422);
    if (!REGIONS.includes(f.region ?? '')) return listPage(person, ctx, 'Choose a primary region.', 422);
    if (ctx.rowsRaw(DATABASE).some((d) => d.user_email === person.email && d.database_name === name && d.deleted !== true)) return listPage(person, ctx, `A database named ${name} exists.`, 409);
    const d = await makeDatabase(ctx, { owner: String(person.email), name, region: f.region! });
    return redirect(consolePath(ctx, `/redis/${String(d.database_id)}`));
  }
  const m = /^\/redis\/([0-9a-f-]{36})(\/delete)?$/.exec(path);
  const d = m ? ctx.rowsRaw(DATABASE).find((x) => x.database_id === m[1] && x.user_email === person.email && x.deleted !== true) : undefined;
  if (!m || !d) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (!m[2]) return request.method === 'GET' ? databasePage(ctx, person, d) : notAllowed();
  if (request.method !== 'POST') return notAllowed();
  if ((formOf(ctx).confirm ?? '').trim() !== d.database_name) return databasePage(ctx, person, d, 'Type the database\'s name to confirm.', 422);
  await ctx.remove(DATABASE, String(d.database_id), 'database.delete');
  return listPage(person, ctx, `Database ${String(d.database_name)} deleted.`);
}
