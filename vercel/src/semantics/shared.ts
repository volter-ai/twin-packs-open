// What Vercel's handlers, pages and doors share: the token a request carries and the team it acts in, a project, the
// apex a domain belongs to, how Vercel sees a domain's DNS (its configuration), and a list's page.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;

export const TOKEN = '_token';
export const TEAM = 'team';
export const PROJECT = 'project';
export const PROJECT_DOMAIN = 'project_domain';
export const DOMAIN = 'domain';
export const EDGE_CONFIG = 'edge_config';
export const EDGE_CONFIG_ITEM = 'edge_config_item';

/** Vercel's refusal: `{ error: { code, message } }`. */
// source: https://vercel.com/docs/rest-api/reference/welcome "error"
export const fail = (status: number, code: string, message: string, extra: Row = {}): Response => Response.json({ error: { code, message, ...extra } }, { status });

export async function makeTeam(ctx: HandlerContext, input: { slug: string; name: string; owner: string }): Promise<Row | Response> {
  const owner = input.owner.toLowerCase();
  const user = await ctx.createUnique('_user', { email: owner }, 'user.create');
  const userId = String(user.row.id);
  const made = await ctx.createUnique(TEAM, {
    slug: input.slug, name: input.name, billing: { plan: 'pro' }, avatar: null, description: null, stagingPrefix: input.slug,
    creatorId: userId, _userId: userId, updatedAt: Date.parse(ctx.occurredAt), createdAt: Date.parse(ctx.occurredAt), _owner: owner, deleted: false,
  }, 'team.create');
  return made.created ? ctx.row(TEAM, String(made.row.id))! : fail(409, 'conflict', `Team slug ${input.slug} is already in use`);
}

export async function makeProject(ctx: HandlerContext, team: Row, name: string): Promise<Row | Response> {
  const made = await ctx.createUnique(PROJECT, {
    name, accountId: team.id, framework: 'nextjs', alias: [], deploymentExpiration: {}, directoryListing: false, nodeVersion: '22.x', resourceConfig: {},
    serverlessFunctionRegion: 'iad1', createdAt: Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), deleted: false,
  }, 'project.create');
  return made.created ? ctx.row(PROJECT, String(made.row.id))! : fail(409, 'conflict', `Project name ${name} is already in use`);
}

export const tokenSecret = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> =>
  (await ctx.secret(`vercel-token:${id}`)).replace(/[-_]/g, '').slice(0, 24);

export async function readToken(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row.deleted === true || (typeof row.expiresAt === 'number' && row.expiresAt <= Date.parse(ctx.occurredAt))) return undefined;
  const secret = await tokenSecret(ctx, String(row.id));
  return row._sha256 === ctx.crypto.sha256(secret) ? secret : undefined;
}

export async function makeToken(ctx: HandlerContext, input: { name: string; team: Row; expiresAt: number | null; project?: string }): Promise<string> {
  const id = await ctx.issue(TOKEN);
  const secret = await tokenSecret(ctx, id);
  await ctx.record(TOKEN, { name: input.name, _owner: input.team._owner, _team: input.team.id, _teamSlug: input.team.slug,
    ...(input.project === undefined ? {} : { _project: input.project }), _sha256: ctx.crypto.sha256(secret), createdAt: Date.parse(ctx.occurredAt), expiresAt: input.expiresAt, deleted: false }, id);
  return id;
}

export async function makeEdgeConfig(ctx: HandlerContext, team: Row, name: string): Promise<Row> {
  const made = await ctx.create(EDGE_CONFIG, { slug: name, ownerId: team.id, digest: ctx.crypto.digest('sha256', '[]').slice(0, 32), itemCount: 0, sizeInBytes: 2,
    createdAt: Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), deleted: false }, 'edge_config.create');
  const id = String(made.id);
  await ctx.write(EDGE_CONFIG, id, { _read_token: ctx.crypto.uuidFrom(await ctx.secret(`edge-config-read:${id}`)) }, 'edge_config.token');
  return ctx.row(EDGE_CONFIG, id)!;
}

/** A stored row as Vercel answers it: the vendor's own fields (its `updatedAt` among them, ctx.own), without the World's
 *  bookkeeping or its tombstone; `withId` puts the subject's id first, for the objects Vercel answers with one (a project,
 *  a team, a domain, an Edge Config; a project domain has none). */
export const view = (ctx: Pick<HandlerContext, 'own'>, r: Row, withId = false): Row => ({
  ...(withId ? { id: r.id } : {}),
  ...Object.fromEntries(Object.entries(ctx.own(r)).filter(([k]) => !k.startsWith('_') && k !== 'deleted')),
});

/** The access token a request carries (`Authorization: Bearer <token>`), live: made on the Account Tokens page, kept by
 *  its SHA-256, not deleted and not past its expiration. */
// source: https://vercel.com/docs/accounts/access-tokens "Authorization"
export function callerToken(ctx: Pick<HandlerContext, 'call' | 'rowsRaw' | 'crypto' | 'occurredAt'>): Row | undefined {
  const bearer = /^bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return undefined;
  const hash = ctx.crypto.sha256(bearer);
  const t = ctx.rowsRaw(TOKEN).find((x) => x._sha256 === hash && x.deleted !== true);
  return t && !(typeof t.expiresAt === 'number' && t.expiresAt <= Date.parse(ctx.occurredAt)) ? t : undefined;
}

/** A missing, deleted or expired token. Where the documentation stops: Vercel's words for it, as its API answers them. */
export const invalidToken = (): Response => fail(403, 'forbidden', 'Not authorized', { invalidToken: true });

/** The team a request acts in: its team-scoped token's ("Team- and project-scoped tokens do not require the teamId query
 *  parameter"); a `?teamId=` naming another team is refused. */
// source: https://vercel.com/docs/accounts/access-tokens "do not require the teamId query parameter"
export function teamFor(ctx: Pick<HandlerContext, 'call' | 'rowsRaw'>, token: Row): Row | Response {
  const asked = new URL(ctx.call.request.url).searchParams.get('teamId');
  const team = ctx.rowsRaw(TEAM).find((t) => t.id === token._team && t.deleted !== true);
  if (!team) return invalidToken();
  if (asked && asked !== team.id && asked !== team.slug) return fail(403, 'forbidden', 'You don\'t have permission to access this team');
  return team;
}

/** The project a path names, by its id or its name, in the team. */
export const projectIn = (ctx: Pick<HandlerContext, 'rowsRaw'>, team: Row, idOrName: string): Row | undefined =>
  ctx.rowsRaw(PROJECT).find((p) => p.accountId === team.id && (p.id === idOrName || p.name === idOrName) && p.deleted !== true);

/** The caller's team and the project the path names (`idOrName`), or the refusal. */
export function scopeOf(ctx: HandlerContext): { team: Row; project?: Row } | Response {
  const token = callerToken(ctx);
  if (!token) return invalidToken();
  const team = teamFor(ctx, token);
  if (team instanceof Response) return team;
  const permitted = typeof token._project === 'string' ? projectIn(ctx, team, token._project) : undefined;
  if (token._project !== undefined && !permitted) return invalidToken();
  const id = ctx.call.params.idOrName;
  if (id === undefined) return { team, ...(permitted ? { project: permitted } : {}) };
  const project = projectIn(ctx, team, String(id));
  return project && (!permitted || project.id === permitted.id) ? { team, project } : fail(404, 'not_found', 'Project not found');
}

/** A project domain's stored id: its project's and its name (the manifest's `key`). */
export const domainKey = (project: Row, name: string): string => `${String(project.id)}::${name}`;

/** A team's domain, by its apex name. */
export const teamDomain = (ctx: Pick<HandlerContext, 'rowsRaw'>, team: Row, apex: string): Row | undefined =>
  ctx.rowsRaw(DOMAIN).find((d) => d.name === apex && d.teamId === team.id && d.deleted !== true);

/** A page of a list Vercel pages by time: newest first by `field` (or oldest first under `order=ASC` where the list takes
 *  it), `since` and `until` bounding it, `limit` items (20 unless asked, at most 100), and its `pagination`: the page's
 *  count, and the timestamps that ask for the next and the previous pages. */
// source: spec:/components/schemas/Pagination "Timestamp that must be used to request the next page."
// source: spec:getProjectDomains "Maximum number of domains to list from a request (max 100)."
export function pageOf(ctx: Pick<HandlerContext, 'call' | 'own'>, rows: Row[], field = 'createdAt'): { items: Row[]; pagination: Row } {
  const q = new URL(ctx.call.request.url).searchParams;
  const asked = Number(q.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 100) : 20;
  const at = (r: Row): number => Number(ctx.own(r)[field] ?? 0);
  const since = Number(q.get('since') ?? NaN);
  const until = Number(q.get('until') ?? NaN);
  const asc = q.get('order') === 'ASC';
  const kept = rows.filter((r) => (Number.isNaN(since) || at(r) > since) && (Number.isNaN(until) || at(r) < until)).sort((a, b) => (asc ? at(a) - at(b) : at(b) - at(a)));
  const items = kept.slice(0, limit);
  return { items, pagination: { count: items.length, next: kept.length > limit ? at(items.at(-1)!) : null, prev: items.length ? at(items[0]!) : null } };
}

// Where the documentation stops: a registrable domain is its last two labels, or three under the two-label public
// suffixes a customer's domain here may end in.
const TWO_LABEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.br', 'com.au', 'co.jp', 'com.pt', 'co.nz']);
export function apexOf(name: string): string {
  const labels = name.replace(/^\*\./, '').split('.');
  const two = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIXES.has(two) ? labels.slice(-3).join('.') : two;
}

/** Vercel's nameservers, which a zone it serves is delegated to. */
// source: https://vercel.com/docs/domains/working-with-nameservers "ns1.vercel-dns.com"
export const VERCEL_NAMESERVERS = ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'];
// source: https://vercel.com/docs/domains/working-with-domains/add-a-domain "cname.vercel-dns-0.com"
export const VERCEL_CNAME = 'cname.vercel-dns-0.com';
/** CNAME targets that point at Vercel: the one its pages name now, and the older one domains set before still use. */
const VERCEL_CNAMES = new Set([VERCEL_CNAME, 'cname.vercel-dns.com']);
// source: https://vercel.com/docs/domains/working-with-domains/add-a-domain "76.76.21.21"
export const VERCEL_A = '76.76.21.21';

/** A record the domain's owner set at their own DNS host (the `dns` door). */
export const externalRecord = (ctx: Pick<HandlerContext, 'rowsRaw' | 'own'>, name: string, type: string): Row | undefined =>
  ctx.rowsRaw('_external_dns').find((r) => r.name === name && ctx.own(r).type === type && r.deleted !== true);

/** How Vercel sees a domain (getDomainConfig): served when its apex is a Vercel zone its registrar delegates to Vercel's
 *  nameservers, or when the owner's DNS host points it at Vercel (a CNAME to Vercel for a subdomain, the A record for an
 *  apex); otherwise "not resolving to Vercel" and misconfigured. */
// source: spec:getDomainConfig "Domain is not resolving to Vercel."
export function configOf(ctx: Pick<HandlerContext, 'rowsRaw' | 'own'>, team: Row, name: string): Row {
  const apex = apexOf(name);
  const zone = teamDomain(ctx, team, apex);
  const delegated = ctx.rowsRaw('_nameservers').find((n) => n.domain === apex && n.deleted !== true);
  const viaZone = zone?.zone === true && JSON.stringify(delegated?.nameservers ?? []) === JSON.stringify(VERCEL_NAMESERVERS);
  const cname = externalRecord(ctx, name, 'CNAME');
  const a = externalRecord(ctx, name, 'A');
  const configuredBy = viaZone ? (name === apex ? 'A' : 'CNAME') : cname && VERCEL_CNAMES.has(String(cname.value).replace(/\.$/, '')) ? 'CNAME' : a && a.value === VERCEL_A ? 'A' : null;
  return {
    configuredBy, acceptedChallenges: configuredBy ? (viaZone ? ['dns-01', 'http-01'] : ['http-01']) : [], misconfigured: configuredBy === null,
    recommendedCNAME: [{ rank: 1, value: `${VERCEL_CNAME}.` }], recommendedIPv4: [{ rank: 1, value: [VERCEL_A] }],
  };
}

/** The verify operation also answers an already verified project domain with the domain, verified (two readers that
 *  each read it unverified, then each asked to verify it). */
// source: spec:verifyProjectDomain "Attempts to verify"
export function alreadyVerified(ctx: HandlerContext, key: string, domain: Row): Response {
  ctx.legal('project_domain', 'verified', 'verifyProjectDomain', 'true', undefined, key);
  return Response.json(view(ctx, domain));
}

/** Projects page with their own from timestamp or an opaque continuation, not domains' until parameter. */
// source: spec:getProjects "Query only projects updated after the given timestamp or continuation token."
export function projectPage(ctx: Pick<HandlerContext, 'call' | 'own'>, rows: Row[]): { items: Row[]; pagination: Row } {
  const query = new URL(ctx.call.request.url).searchParams;
  const limit = Math.min(Math.max(Number(query.get('limit')) || 20, 1), 100);
  const from = query.get('from');
  const split = from?.indexOf(':') ?? -1;
  const after = Number(split >= 0 ? from!.slice(0, split) : from ?? NaN);
  // Where the documentation stops: continuation bytes are opaque. This local continuation orders ties by subject.
  const afterId = split >= 0 ? from!.slice(split + 1) : undefined;
  const time = (row: Row): number => Number(ctx.own(row).updatedAt);
  const ordered = rows.filter((r) => Number.isNaN(after) || time(r) > after || (time(r) === after && afterId !== undefined && String(r.id) > afterId))
    .sort((a, b) => time(a) - time(b) || String(a.id).localeCompare(String(b.id)));
  const items = ordered.slice(0, limit);
  const last = items.at(-1);
  return { items, pagination: { count: items.length, next: ordered.length > limit && last ? `${time(last)}:${String(last.id)}` : null, prev: null } };
}

// source: spec:patchEdgeConfigItems "items"
export async function updateEdgeConfigItems(ctx: HandlerContext): Promise<Response> {
  const scoped = scopeOf(ctx);
  if (scoped instanceof Response) return scoped;
  const id = String(ctx.call.params.edgeConfigId);
  const store = ctx.rowsRaw(EDGE_CONFIG).find((e) => e.id === id && e.ownerId === scoped.team.id && (!scoped.project || e._project === scoped.project.name) && e.deleted !== true);
  if (!store) return fail(404, 'not_found', 'Could not find the Edge Config');
  const items = (ctx.body as Row | undefined)?.items;
  // source: spec:patchEdgeConfigItems "One of the provided values in the request body is invalid."
  if (!Array.isArray(items) || items.some((it) => !it || typeof it !== 'object' || Array.isArray(it))) return fail(400, 'bad_request', 'items must be an array of item operations');
  const held = (key: string): Row | undefined => ctx.rowsRaw(EDGE_CONFIG_ITEM).find((i) => i.id === `${id}::${key}` && i.deleted !== true);
  const projected = new Set(ctx.rowsRaw(EDGE_CONFIG_ITEM).filter((i) => i.edgeConfigId === id).map((i) => String(i.key)));
  for (const it of items as Row[]) {
    const key = String(it.key ?? '');
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) return fail(400, 'bad_request', `Invalid key "${key}"`);
    if (it.operation === 'create' && projected.has(key)) return fail(409, 'conflict', `Item "${key}" already exists`);
    if (it.operation === 'update' && !projected.has(key)) return fail(404, 'not_found', `Item "${key}" does not exist`);
    if (!['create', 'update', 'upsert', 'delete'].includes(String(it.operation))) return fail(400, 'bad_request', `Invalid operation "${String(it.operation)}"`);
    if (it.description !== undefined && typeof it.description !== 'string') return fail(400, 'bad_request', 'description must be a string');
    if (it.operation === 'delete') projected.delete(key); else projected.add(key);
  }
  for (const it of items as Row[]) {
    const key = String(it.key);
    if (it.operation === 'delete') { if (held(key)) await ctx.remove(EDGE_CONFIG_ITEM, `${id}::${key}`, 'edge_config_item.delete'); continue; }
    await ctx.write(EDGE_CONFIG_ITEM, `${id}::${key}`, { key, ...(Object.hasOwn(it, 'value') ? { value: it.value as never } : {}), ...(typeof it.description === 'string' ? { description: it.description } : {}), edgeConfigId: id, createdAt: ctx.own(held(key) ?? {}).createdAt ?? Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), deleted: false }, 'edge_config_item.write');
  }
  // an Edge Config's digest names its content: every read sends it back (`x-edge-config-digest`)
  const content = ctx.rowsRaw(EDGE_CONFIG_ITEM).filter((i) => i.edgeConfigId === id && i.deleted !== true).map((i) => [i.key, i.value]).sort();
  await ctx.write(EDGE_CONFIG, id, { digest: ctx.crypto.digest('sha256', JSON.stringify(content)).slice(0, 32), itemCount: content.length, sizeInBytes: new TextEncoder().encode(JSON.stringify(Object.fromEntries(content))).byteLength, updatedAt: Date.parse(ctx.occurredAt) }, 'edge_config.items');
  return Response.json({ status: 'ok' });
}
