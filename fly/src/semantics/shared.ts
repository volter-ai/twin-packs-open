// What Fly's Machines API shares: its error body, the caller (an organization token, or a deploy token scoped to one
// app), and the views of an app, a machine and a volume.
import type { HandlerContext, MachineStatus } from '@volter/world-core';

export type Row = Record<string, unknown>;

export function obj(v: unknown): Row {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
}
export function sha256(ctx: Pick<HandlerContext, 'crypto'>, v: string): string {
  return ctx.crypto.digest('sha256', v, 'hex');
}
/** Fly's error body (the spec's ErrorResponse). Where the documentation stops: the messages are the twin's. */
export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export type Caller = { org: string; app?: string };
/** The caller `Authorization` names (`Bearer`, or flyctl's `FlyV1`): its organization, and its app when a deploy token. */
export function callerOf(ctx: HandlerContext): Caller | Response {
  const value = /^(?:Bearer|FlyV1)\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const t = value ? ctx.rowsRaw(TOKEN).find((r) => r.deleted !== true && r.sha256 === sha256(ctx, value)) : undefined;
  if (!t) return fail(401, 'unauthorized');
  return { org: String(t.org), ...(t.app ? { app: String(t.app) } : {}) };
}

/** The app a path names, when the caller may reach it (an organization's, or the deploy token's own). */
export function appFor(ctx: HandlerContext, c: Caller): Row | Response {
  const name = String(ctx.call.params.app_name);
  const app = ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.name === name);
  if (!app || app._org !== c.org || (c.app !== undefined && c.app !== name)) return fail(404, 'app not found');
  return app;
}

export async function makeApp(ctx: HandlerContext, name: string, org: string, network: unknown): Promise<Row | Response> {
  const made = await ctx.createUnique(APP, (id) => ({ id, name, status: 'pending', network, organization: { name: org, slug: org }, machine_count: 0, volume_count: 0, _org: org }), 'Apps_create');
  return made.created ? ctx.row(APP, String(made.row.id))! : fail(422, `app name "${name}" is already taken`);
}

/** An app as `GET /apps/{app}` answers it, with its counts. */
export function appView(ctx: HandlerContext, a: Row): Row {
  return ctx.get(APP, String(a.id))!;
}

/** A machine as the API answers it: the stored machine, with the ports the World's pool published for it. */
export function machineView(ctx: HandlerContext, m: Row): Row {
  const view = ctx.get(MACHINE, String(m.id))!;
  // the World's disclosed additive field (Substrate reads it): each internal port and the loopback port it is on
  const ports = m._ports as Array<{ internal: number; host: number }> | undefined;
  return m.state === 'started' && ports?.length ? { ...view, twin_local_ports: ports } : view;
}

export function volumeView(ctx: HandlerContext, v: Row): Row {
  return ctx.get(VOLUME, String(v.id))!;
}

/** A machine destroyed: its image removed from the pool, its volumes let go. */
export async function destroy(ctx: HandlerContext, m: Row, operation: string, actor?: 'vendor'): Promise<Response> {
  const refused = ctx.legal(MACHINE, 'state', operation, m.state, 'destroyed', String(m.id), actor);
  if (refused) return fail(refused.status, refused.message);
  await ctx.machines.remove(String(m.id));
  await ctx.write(MACHINE, String(m.id), { state: 'destroyed', updated_at: ctx.occurredAt, _ports: [] }, operation);
  for (const v of ctx.rowsRaw(VOLUME).filter((x) => x.attached_machine_id === m.id)) await ctx.write(VOLUME, String(v.id), { attached_machine_id: null }, 'volume.detach');
  return Response.json({ ok: true });
}

/** Every process exit, including zero, stops its Fly Machine. The runner owns process outcomes, Fly owns states. */
// source: https://docs.fly.io/machines/machine-states/ "Exited, either on its own or explicitly stopped"
export async function exitedMachine(ctx: HandlerContext, m: Row, status?: MachineStatus): Promise<Response> {
  const refused = ctx.legal(MACHINE, 'state', 'machine.exit', m.state, 'stopped', String(m.id), 'external');
  if (refused) return Response.json({ message: 'the machine is not running' }, { status: 409 });
  await ctx.machines.stop(String(m.id));
  await ctx.write(MACHINE, String(m.id), {
    state: 'stopped', updated_at: ctx.occurredAt, _ports: [],
    events: [{ type: 'exit', status: 'stopped', source: 'flyd', timestamp: Date.parse(ctx.occurredAt),
      request: { ...(status?.exitCode !== undefined ? { exit_code: status.exitCode } : {}), ...(status?.reason ? { error: status.reason } : {}) } },
      ...(Array.isArray(m.events) ? m.events : [])],
  }, 'machine.exit');
  if (obj(m.config).auto_destroy === true) await destroy(ctx, ctx.row(MACHINE, String(m.id))!, 'machine.auto_destroy', 'vendor');
  return Response.json({ id: m.id, state: ctx.row(MACHINE, String(m.id))!.state });
}

/** Observe an owned guest before returning the vendor's machine state. */
export async function observeMachine(ctx: HandlerContext, m: Row): Promise<void> {
  if (m.state !== 'started') return;
  const status = await ctx.machines.status(String(m.id));
  if (!status || status.state === 'started' || status.state === 'paused') return;
  const answer = await exitedMachine(ctx, m, status);
  if (!answer.ok) throw new Error('the guest exit transition was refused');
}

// the stored types' names, below the functions that read them at call time (Bun's coverage reads a function declared
// below module-scope constants as unrun: life-coverage.ts, the instrument's limits)
export const APP = 'App';
export const MACHINE = 'Machine';
export const VOLUME = 'Volume';
export const TOKEN = '_token';
