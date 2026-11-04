// What E2B's lanes share: its error body, a team's API key, and its sandboxes and templates as the API answers them.
import type { HandlerContext, DerivedManifest } from '@volter/world-core';

// source: spec:/components/schemas/Error "sandbox_create_failed"
export async function sandboxCreateFailed(ctx: HandlerContext, id: string, error: unknown): Promise<Response> {
  await ctx.remove(SANDBOX, id, 'sandbox.create_failed');
  return Response.json({ code: 500, message: `the sandbox did not start: ${String((error as Error).message ?? error).slice(0, 200)}`, error_code: 'sandbox_create_failed' }, { status: 500 });
}

/** The documented unreachable-sandbox class; vendor documentation gives no exact diagnostic text. */
export function processUnavailable(id: string): Response {
  return Response.json({ code: 'unavailable', message: `The sandbox ${id} could not be reached` }, { status: 502 });
}

export type Row = Record<string, unknown>;
export const TEAM = '_team';
export const TEMPLATE = 'template';
export const SANDBOX = 'sandbox';
/** The envd version the twin's sandboxes run. Where the documentation stops: the version E2B's current templates carry. */
export const ENVD_VERSION = '0.2.0';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// source: spec:/components/schemas/Error "Error code"
/** E2B's error body: `{code, message}`. */
export const e2bError = (code: number, message: string): Response => Response.json({ code, message }, { status: code });

export async function readProjectKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row.deleted === true || row.revoked === true) return undefined;
  const key = `e2b_${sha256(ctx, await ctx.secret(String(row.label))).slice(0, 40)}`;
  return row.key_sha256 === sha256(ctx, key) ? key : undefined;
}

export async function projectKey(ctx: HandlerContext, team: Row): Promise<string> {
  const prior = ctx.rowsRaw('_api_key', { withDeleted: true }).filter((row) => row._team === team.id);
  const live = prior.find((row) => row.deleted !== true);
  if (live && await readProjectKey(ctx, live)) return String(live.id);
  if (live && live.revoked !== true && live.key_sha256 === undefined && typeof live.label === 'string') {
    const key = `e2b_${sha256(ctx, await ctx.secret(live.label)).slice(0, 40)}`;
    await ctx.record('_api_key', { key_sha256: sha256(ctx, key) }, String(live.id));
    await ctx.record(TEAM, { key_sha256: sha256(ctx, key) }, String(team.id));
    return String(live.id);
  }
  if (live) await ctx.record('_api_key', { deleted: true }, String(live.id));
  const made = await ctx.createUnique('_api_key', (id) => ({ _team: team.id,
    label: prior.length ? `e2b-api-key:${id}` : `e2b-api-key:${team.id}`, createdAt: ctx.occurredAt,
  }), 'api_key.create', { input: 'omit' });
  const row = ctx.row('_api_key', String(made.row.id))!;
  const key = `e2b_${sha256(ctx, await ctx.secret(String(row.label))).slice(0, 40)}`;
  await ctx.record('_api_key', { key_sha256: sha256(ctx, key) }, String(row.id));
  await ctx.record(TEAM, { key_sha256: sha256(ctx, key) }, String(team.id));
  return String(row.id);
}

/** The team/project whose live API key a request carries. */
export function teamOf(ctx: HandlerContext): Row | undefined {
  const key = ctx.call.request.headers.get('x-api-key');
  if (!key) return undefined;
  const native = ctx.rowsRaw('_api_key', { withDeleted: true });
  const row = native.find((row) => row.key_sha256 === sha256(ctx, key));
  if (row) return row.deleted === true || row.revoked === true ? undefined : ctx.row(TEAM, String(row._team));
  const team = ctx.rowsRaw(TEAM).find((row) => row.key_sha256 === sha256(ctx, key));
  return team && !native.some((row) => row._team === team.id) ? team : undefined;
}

/** A stored row's vendor fields: its own fields without the kernel's bookkeeping. */
export const vendorFields = (ctx: HandlerContext, row: Row): Row => Object.fromEntries(Object.entries(ctx.own(row)).filter(([k]) => !k.startsWith('_')));

/** Whether a stored row belongs to the project, including the root's observed rows for its default project. */
export const ofTeam = (row: Row, team: Row): boolean => row._team === team.id || (row._team === undefined && team._default === true);

/** A team's live rows of a resource, as the vendor answers them. */
export const teamRows = (ctx: HandlerContext, resource: string, team: Row): Row[] =>
  ctx.rowsRaw(resource).filter((r) => ofTeam(r, team)).map((r) => vendorFields(ctx, r));

/** A list as E2B pages it: at most `limit` items (1 to 100, 100 unless asked), from the one after `nextToken`, the next
 *  page's token in `X-Next-Token` when there is one. */
// source: spec:/components/parameters/paginationLimit "Maximum number of items to return per page"
// source: spec:/components/parameters/paginationNextToken "Cursor to start the list from"
export function paged(ctx: HandlerContext, items: Row[], idField: string): Response {
  const q = new URL(ctx.call.request.url).searchParams;
  const limit = q.has('limit') ? Number(q.get('limit')) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return e2bError(400, 'limit must be between 1 and 100');
  const token = q.get('nextToken');
  const from = token ? items.findIndex((i) => i[idField] === token) + 1 : 0;
  if (token && from === 0) return e2bError(400, 'invalid next token');
  const page = items.slice(from, from + limit);
  const more = from + limit < items.length;
  return Response.json(page, { status: 200, headers: more ? { 'x-next-token': String(page.at(-1)![idField]) } : {} });
}

/** The create/connect answer is a view of the stored sandbox, never its internal fields. */
export function sandboxAnswer(ctx: HandlerContext, row: Row): Row {
  const sb = vendorFields(ctx, row);
  return Object.fromEntries(['templateID', 'sandboxID', 'alias', 'clientID', 'envdVersion', 'domain'].filter((k) => sb[k] !== undefined).map((k) => [k, sb[k]]).concat(row._envdAccessToken ? [['envdAccessToken', row._envdAccessToken]] : []));
}

/** A compute request reaches only its sandbox's published service. */
export async function liveSandbox(ctx: HandlerContext, lifecycle: DerivedManifest): Promise<Row | Response> {
  ctx = await ctx.over(lifecycle);
  const id = String(ctx.call.params.sandboxID ?? '');
  let sb = ctx.row(SANDBOX, id);
  if (sb?._envdAccessToken && ctx.call.request.headers.get('x-access-token') !== sb._envdAccessToken) return Response.json({ code: 'unauthenticated', message: 'Invalid access token' }, { status: 401 });
  // source: https://docs.e2b.dev/sandbox/persistence "Paused: The sandbox execution is suspended but its state is preserved."
  if (sb?.state === 'paused' && sb._autoResume === true) {
    const refusal = ctx.legal(SANDBOX, 'state', 'sandbox.traffic', 'paused', 'running', id, 'vendor');
    if (refusal) return ctx.refuse(refusal);
    await ctx.machines.resume(id);
    await ctx.write(SANDBOX, id, { state: 'running', endAt: new Date(Date.parse(ctx.occurredAt) + Number(sb._timeout) * 1000).toISOString() }, 'sandbox.traffic');
    sb = ctx.row(SANDBOX, id);
  }
  // Documentation stops at E2B's unreachable-sandbox class; messages are local diagnostics.
  if (!sb || sb.state !== 'running') return Response.json({ code: 'unavailable', message: `The sandbox ${id} was not found` }, { status: 502 });
  return sb;
}

export async function machineRequest(ctx: HandlerContext, port: number, lifecycle: DerivedManifest): Promise<Response> {
  const sb = await liveSandbox(ctx, lifecycle);
  const rest = new URL(ctx.call.request.url).pathname === '/files';
  const unavailable = (response: Response): Response | Promise<Response> => rest ? response.json().then((body: { message?: string }) => e2bError(response.status, body.message ?? response.statusText)) : response;
  if (sb instanceof Response) return unavailable(sb);
  const id = String(ctx.call.params.sandboxID ?? '');
  try { return await ctx.machines.request(id, port, ctx.call.request); } catch { return unavailable(processUnavailable(id)); }
}
