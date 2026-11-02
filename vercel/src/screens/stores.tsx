// VERCEL'S STORAGE PAGE — vercel.com/{team}/stores: Create Edge Config (a name), and Connect Project, which gives the
// project its connection string `EDGE_CONFIG` ("https://edge-config.vercel.com/<id>?token=<read token>",
// https://vercel.com/docs/edge-config/get-started). A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, signedIn } from '@volter/world-ui';
import { EDGE_CONFIG, PROJECT } from '../semantics/shared.ts';
import { COOKIE, notAllowed, type Row, SKIN, teamsOf, toLogin } from './shared.tsx';

// source: https://raw.githubusercontent.com/vercel/storage/main/packages/global-config/src/index.ts "process.env.GLOBAL_CONFIG ?? process.env.EDGE_CONFIG"
const connection = (e: Row): string => `https://edge-config.vercel.com/${String(e.id)}?token=${String(e._read_token)}`;

function page(ctx: HandlerContext, team: Row, notice?: string, status = 200): Response {
  const stores = ctx.rowsRaw(EDGE_CONFIG).filter((e) => e.ownerId === team.id && e.deleted !== true);
  const projects = ctx.rowsRaw(PROJECT).filter((p) => p.accountId === team.id && p.deleted !== true);
  const base = `/${String(team.slug)}/stores`;
  return flowPage({
    title: 'Storage | Vercel', css: [PORTAL_CSS, SKIN], status,
    body: (
      <Portal
        merchant={`${String(team.slug)} · Storage`}
        {...(notice ? { notice } : {})}
        sections={[{ heading: 'Edge Config', empty: 'No stores yet.', items: stores.map((e) => ({ title: String(e.slug), detail: `${String(e.id)} · ${Number(e.itemCount ?? 0)} items${e._project ? ` · connected to ${String(e._project)}` : ''}` })) }]}
        forms={[
          { heading: 'Create Edge Config', action: `${base}?do=create`, fields: [{ id: 'name', label: 'Name' }], submit: { label: 'Create' } },
          { heading: 'Connect Project', action: `${base}?do=connect`, fields: [{ id: 'store', label: 'Edge Config', options: stores.map((e) => ({ value: String(e.id), label: String(e.slug) })) }, { id: 'project', label: 'Project', options: projects.map((p) => ({ value: String(p.name), label: String(p.name) })) }], submit: { label: 'Connect' } },
        ]}
      />
    ),
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const slug = String(ctx.call.params.team ?? '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(`/${slug}/stores`);
  const team = teamsOf(ctx, person).find((t) => t.slug === slug);
  if (!team) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (request.method === 'GET') return page(ctx, team);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const act = new URL(request.url).searchParams.get('do'); if (act !== 'create' && act !== 'connect') return unknownAction(ctx, team);
  if (act === 'create') {
    const name = (f.name ?? '').trim();
    if (!/^[a-z0-9_-]{1,64}$/.test(name)) return page(ctx, team, 'A name of lowercase letters, digits, - and _ is required.', 422);
    const id = `ecfg_${ctx.mint('edge_config')}`;
    const token = ctx.crypto.uuidFrom(await ctx.secret(`edge-config-read:${id}`));
    await ctx.write(EDGE_CONFIG, id, { id, slug: name, ownerId: team.id, digest: ctx.crypto.digest('sha256', '[]').slice(0, 32), itemCount: 0, sizeInBytes: 2, createdAt: Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), _read_token: token, deleted: false }, 'edge_config.create');
    return page(ctx, team, `Edge Config ${name} created: ${id}.`, 201);
  }
  const store = ctx.rowsRaw(EDGE_CONFIG).find((e) => e.id === f.store && e.ownerId === team.id && e.deleted !== true);
    const project = ctx.rowsRaw(PROJECT).find((p) => p.name === f.project && p.accountId === team.id && p.deleted !== true);
    if (!store || !project) return page(ctx, team, 'Choose an Edge Config and a project.', 422);
    await ctx.write(EDGE_CONFIG, String(store.id), { _project: project.name }, 'edge_config.connect');
    return page(ctx, team, `Connected to ${String(project.name)}: EDGE_CONFIG=${connection(store)}`);
}

function unknownAction(ctx: HandlerContext, team: Row): Response {
  return page(ctx, team, 'Choose an action.', 422);
}
