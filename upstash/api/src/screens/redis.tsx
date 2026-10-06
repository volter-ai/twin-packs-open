// UPSTASH'S REDIS PAGES — console.upstash.com/redis: "Create Database", its name and primary region, then the
// database's page with its REST endpoint and tokens, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and "For
// the Read Only token, just enable the Read-Only Token switch" (https://upstash.com/docs/redis/overall/getstarted;
// https://upstash.com/docs/redis/features/restapi). Its Delete asks the database's name to confirm. A person sees the
// databases they made. Where the documentation stops: the regions offered are AWS's the page lists first, the plan is
// the free one, and the confirmation is typing the name. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, redirect, signedIn } from '@volter/world-ui';
import { DATABASE, makeDatabase } from '../semantics/shared.ts';
import { COOKIE, notAllowed, type Row, SKIN, toLogin } from './shared.tsx';

// source: https://upstash.com/docs/redis/overall/getstarted "Create Database"
const REGIONS = ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1', 'sa-east-1'];

function listPage(person: Row, ctx: HandlerContext, notice?: string, status = 200): Response {
  const mine = ctx.rowsRaw(DATABASE).filter((d) => d.user_email === person.email && d.deleted !== true);
  return flowPage({
    title: 'Redis | Upstash Console', css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(person.email)} · Redis`}
        {...(notice ? { notice } : {})}
        sections={[{ heading: 'Databases', empty: 'No databases yet.', items: mine.map((d) => ({ title: String(d.database_name), detail: `${String(d.primary_region)} · Free`, actions: [{ label: 'Open', action: `/redis/${String(d.database_id)}`, method: 'get' as const }] })) }]}
        forms={[{ heading: 'Create Database', action: '/redis', fields: [{ id: 'name', label: 'Name' }, { id: 'region', label: 'Primary Region', options: REGIONS.map((r) => ({ value: r, label: r })) }], submit: { label: 'Create' } }]}
      />
    ),
  });
}

function databasePage(person: Row, d: Row, notice?: string, status = 200): Response {
  const url = `https://${String(d.endpoint)}.upstash.io`;
  return flowPage({
    title: `${String(d.database_name)} | Upstash Console`, css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(person.email)} · ${String(d.database_name)}`}
        back={{ href: '/redis', label: 'Redis' }}
        {...(notice ? { notice } : {})}
        sections={[{
          heading: 'REST API',
          empty: '',
          items: [
            { title: 'UPSTASH_REDIS_REST_URL', detail: url },
            { title: 'UPSTASH_REDIS_REST_TOKEN', detail: String(d.rest_token) },
            { title: 'Read-Only Token', detail: String(d.read_only_rest_token) },
            { title: 'Endpoint', detail: `${String(d.endpoint)}.upstash.io:6379 · TLS` },
          ],
        }]}
        forms={[{ heading: 'Delete this database', action: `/redis/${String(d.database_id)}/delete`, fields: [{ id: 'confirm', label: `Type ${String(d.database_name)} to confirm` }], submit: { label: 'Delete' } }]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(path);
  if (path === '/redis') {
    if (request.method === 'GET') return listPage(person, ctx);
    if (request.method !== 'POST') return notAllowed();
    const f = formOf(ctx);
    const name = (f.name ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return listPage(person, ctx, 'A name of letters, digits, hyphens and underscores is required.', 422);
    if (!REGIONS.includes(f.region ?? '')) return listPage(person, ctx, 'Choose a primary region.', 422);
    if (ctx.rowsRaw(DATABASE).some((d) => d.user_email === person.email && d.database_name === name && d.deleted !== true)) return listPage(person, ctx, `A database named ${name} exists.`, 409);
    const d = await makeDatabase(ctx, { owner: String(person.email), name, region: f.region! });
    return redirect(`/redis/${String(d.database_id)}`);
  }
  const m = /^\/redis\/([0-9a-f-]{36})(\/delete)?$/.exec(path);
  const d = m ? ctx.rowsRaw(DATABASE).find((x) => x.database_id === m[1] && x.user_email === person.email && x.deleted !== true) : undefined;
  if (!m || !d) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (!m[2]) return request.method === 'GET' ? databasePage(person, d) : notAllowed();
  if (request.method !== 'POST') return notAllowed();
  if ((formOf(ctx).confirm ?? '').trim() !== d.database_name) return databasePage(person, d, 'Type the database\'s name to confirm.', 422);
  await ctx.remove(DATABASE, String(d.database_id), 'database.delete');
  return listPage(person, ctx, `Database ${String(d.database_name)} deleted.`);
}
