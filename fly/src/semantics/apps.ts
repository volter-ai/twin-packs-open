// Apps: a machine belongs to one. Names are unique across Fly; an app is its organization's.
import { isMachineCapabilityGap, type HandlerContext, type MachineSpec } from '@volter/world-core';
import { APP, appFor, appView, callerOf, destroy, fail, MACHINE, machineView, obj, type Row, VOLUME, volumeView, observeMachine } from './shared.ts';

// source: https://docs.fly.io/machines/api/apps-resource/ "Get details about an app, like its organization slug and name. Also, to check if the app exists!"
export async function Apps_show(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  return app instanceof Response ? app : Response.json(appView(ctx, app));
}

// source: https://docs.fly.io/machines/api/apps-resource/ "Machines must be associated with a Fly App. App names must be unique."
export async function Apps_create(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const b = obj(ctx.body);
  const name = String(b.app_name ?? b.name ?? '');
  // Where the documentation stops: a name's form is flyctl's (lowercase letters, digits and dashes); the refusal is the twin's
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) return fail(400, 'invalid app name: use lowercase letters, numbers and dashes');
  if (c.app !== undefined || String(b.org_slug ?? '') !== c.org) return fail(403, `organization not found or not accessible: ${String(b.org_slug ?? '')}`);
  if (ctx.rowsRaw(APP).some((a) => a.deleted !== true && a.name === name)) return fail(422, `app name "${name}" is already taken`);
  const made = await makeApp(ctx, name, c.org, b.network ?? 'default');
  if (made instanceof Response) return made;
  const id = String(made.id);
  // source: https://docs.fly.io/machines/api/apps-resource/ "Status: 201 created"
  return Response.json({ id, created_at: Date.parse(ctx.occurredAt) }, { status: 201 });
}

export async function makeApp(ctx: HandlerContext, name: string, org: string, network: unknown): Promise<Row | Response> {
  const made = await ctx.createUnique(APP, (id) => ({ id, name, status: 'pending', network, organization: { name: org, slug: org }, machine_count: 0, volume_count: 0, _org: org }), 'Apps_create');
  return made.created ? ctx.row(APP, String(made.row.id))! : fail(422, `app name "${name}" is already taken`);
}

/** The machine a path names, in the caller's app. */
function machineFor(ctx: HandlerContext): { app: Row; machine: Row } | Response {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  if (app instanceof Response) return app;
  const machine = ctx.row(MACHINE, String(ctx.call.params.machine_id));
  if (!machine || machine._app !== app.name) return fail(404, 'machine not found');
  return { app, machine };
}

/** Run a machine's image on the World's pool: its env, and each service's internal port published. */
function machineSpec(m: Row): MachineSpec {
  const config = obj(m.config);
  const ports = (Array.isArray(config.services) ? config.services as Row[] : []).map((s) => Number(s.internal_port)).filter((p) => Number.isInteger(p));
  const env = { FLY_APP_NAME: String(m._app), FLY_REGION: String(m.region), ...Object.fromEntries(Object.entries(obj(config.env)).map(([k, v]) => [k, String(v)])) };
  const checks = Object.values(obj(config.checks)).map(obj).filter(c => c.type === 'http' || c.type === 'tcp').map(c => ({ port: Number(c.port), type: c.type as 'http' | 'tcp', ...(typeof c.path === 'string' ? { path: c.path } : {}) }));
  // source: spec:Machines_wait "This request will block for up to 60 seconds."
  return { name: String(m.id), image: String(config.image), env, ports, checks, startTimeoutMs: 60_000, resetOnStop: true, mounts: (Array.isArray(config.mounts) ? config.mounts as Row[] : []).map(mount => ({ name: String(mount.volume), path: String(mount.path) })), command: Array.isArray(obj(config.init).exec) ? obj(config.init).exec as string[] : undefined };
}

/** Architecture, "Other wires: … machines": admission limits answer the declared gap before stored mutation. */
async function admit(ctx: HandlerContext, m: Row): Promise<Response | undefined> {
  try { await ctx.machines.admitRun?.({ ...machineSpec(m), signal: ctx.call.request.signal }); }
  catch (error) {
    if (isMachineCapabilityGap(error)) return ctx.gap();
    // Execution failures are observed by run; admission does not invent vendor failure state.
  }
}
async function run(ctx: HandlerContext, m: Row): Promise<Response | void> {
  let ran;
  try { ran = await ctx.machines.run({ ...machineSpec(m), signal: ctx.call.request.signal }); }
  catch (error) {
    if (isMachineCapabilityGap(error)) return ctx.gap();
    return failedLaunch(ctx, m, error);
  }
  const instance = ctx.mint('_instance');
  await ctx.record('_instance', { machine: m.id }, instance);
  await ctx.write(MACHINE, String(m.id), { state: 'started', instance_id: instance.toUpperCase(), version: instance.toUpperCase(), events: [{ type: 'start', status: 'started', source: 'flyd', timestamp: Date.parse(ctx.occurredAt) }, ...(Array.isArray(m.events) ? m.events : [])], updated_at: ctx.occurredAt, _ports: ran.ports }, 'machine.started');
}

/** A failing execution backend is outside a fake-pool API walk. */
async function failedLaunch(ctx: HandlerContext, m: Row, error: unknown): Promise<void> {
  // the pool could not start it: the machine failed, as a machine whose image does not start does
  const refused = ctx.legal(MACHINE, 'state', 'machine.failed', m.state, 'failed', String(m.id), 'vendor');
  if (refused) throw new Error(refused.message);
  await ctx.write(MACHINE, String(m.id), { state: 'failed', updated_at: ctx.occurredAt, _ports: [], events: [{ type: 'launch', status: 'failed', source: 'flyd', timestamp: Date.parse(ctx.occurredAt), request: { error: String((error as Error).message ?? error).slice(0, 200) } }] }, 'machine.failed');
  return;
}

// source: spec:Machines_list "List all Machines associated with a specific app"
export async function Machines_list(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  if (app instanceof Response) return app;
  const q = new URL(ctx.call.request.url).searchParams;
  // source: spec:Machines_list "Filter by a machine metadata key and exact value."
  const machines = ctx.rowsRaw(MACHINE).filter((m) => m._app === app.name
    && (q.get('include_deleted') === 'true' || m.state !== 'destroyed')
    && (!q.get('region') || m.region === q.get('region'))
    && (!q.get('state') || q.get('state')!.split(',').includes(String(m.state)))
    && [...q].filter(([k]) => k.startsWith('metadata.')).every(([k, v]) => obj(obj(m.config).metadata)[k.slice(9)] === v));
  return Response.json(machines.map((m) => machineView(ctx, m)));
}

// source: spec:Machines_create "Create a Machine within a specific app"
export async function Machines_create(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  if (app instanceof Response) return app;
  const b = obj(ctx.body);
  const config = obj(b.config);
  if (typeof config.image !== 'string' || !config.image) return fail(400, 'invalid config: image is required');
  const guest = obj(config.guest);
  // Where the documentation stops: Fly sizes guest memory in 256 MiB steps (Substrate rounds so); the refusal is the twin's
  if (guest.memory_mb !== undefined && Number(guest.memory_mb) % 256 !== 0) return fail(400, 'invalid config.guest.memory_mb: must be a multiple of 256');
  const mounts = Array.isArray(config.mounts) ? config.mounts as Row[] : [];
  for (const mount of mounts) {
    const v = ctx.row(VOLUME, String(mount.volume));
    if (!v || v._app !== app.name || v.state !== 'created') return fail(400, `volume ${String(mount.volume)} not found`);
    if (v.attached_machine_id) return fail(412, `failed_precondition: volume ${String(v.id)} is attached to another machine`);
  }
  const id = ctx.mint(MACHINE);
  const commandGap = await admit(ctx, { id, config, _app: app.name, region: b.region ?? 'iad' });
  if (commandGap) return commandGap;
  const image = String(config.image);
  const parts = image.split('/');
  const registry = parts[0].includes('.') || parts[0].includes(':') ? parts.shift()! : 'registry-1.docker.io';
  const [repository, tag = 'latest'] = parts.join('/').split(':');
  const machine: Row = {
    id, name: String(b.name ?? id), state: 'created', region: String(b.region ?? 'iad'), instance_id: (await ctx.issue('_instance')).toUpperCase(),
    private_ip: `fdaa:0:${id.slice(0, 4)}:a7b:${id.slice(4, 8)}:${id.slice(8, 12)}:${id.slice(12, 14)}:2`,
    config, image_ref: { registry, repository, tag, digest: '', labels: {} }, created_at: ctx.occurredAt, updated_at: ctx.occurredAt,
    events: [{ type: 'launch', status: 'created', source: 'user', timestamp: Date.parse(ctx.occurredAt) }], host_status: 'ok',  _app: app.name,
  };
  await ctx.write(MACHINE, id, machine, 'Machines_create');
  for (const mount of mounts) await ctx.write(VOLUME, String(mount.volume), { attached_machine_id: id }, 'volume.attach');
  const answer = machineView(ctx, ctx.row(MACHINE, id)!);
  // source: https://docs.fly.io/machines/machine-states/ "Machines are launched automatically upon creation"
  if (b.skip_launch !== true) {
    const refused = ctx.legal(MACHINE, 'state', 'machine.launch', 'created', 'started', id, 'vendor');
    if (refused) throw new Error(refused.message);
    const gap = await run(ctx, ctx.row(MACHINE, id)!);
    if (gap) return gap;
  }
  return Response.json(answer);
}

// source: spec:Machines_show "Get details of a specific Machine within an app by the Machine ID."
export async function Machines_show(ctx: HandlerContext): Promise<Response> {
  const at = machineFor(ctx);
  return at instanceof Response ? at : Response.json(machineView(ctx, at.machine));
}

// source: spec:Machines_wait "Wait for a Machine to reach a specific state."
export async function Machines_wait(ctx: HandlerContext): Promise<Response> {
  const at = machineFor(ctx);
  if (at instanceof Response) return at;
  const q = new URL(ctx.call.request.url).searchParams;
  const state = q.get('state') ?? 'started';
  if (!['started', 'stopped', 'suspended', 'destroyed', 'failed', 'settled'].includes(state)) return fail(400, `invalid state: ${state}`);
  const timeout = q.get('timeout') === null ? 60 : Number(q.get('timeout'));
  // source: spec:Machines_wait "This request will block for up to 60 seconds."
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60) return fail(400, 'invalid timeout: must be between 1 and 60 seconds');
  let current = at.machine;
  const reached = (): boolean => current.state === state || (state === 'settled' && current.state !== 'created');
  // The kernel owns elapsed time; timeout is the vendor's requested limit, cadence Substrate's discovery interval.
  if (['light', 'docker'].includes(ctx.machines.kind)) await ctx.awaitCondition([MACHINE], timeout * 1000, 200, async () => {
    await ctx.asVendor(() => observeMachine(ctx, current));
    current = ctx.row(MACHINE, String(current.id))!;
    return reached();
  });
  // Where the documentation stops: a wait that times out answers 408 with the twin's message
  if (!reached()) return fail(408, `deadline_exceeded: machine did not reach state ${state} within ${timeout}s`);
  return Response.json({ ok: true });
}

// source: spec:Machines_stop "Stop a specific Machine within an app"
export async function Machines_stop(ctx: HandlerContext): Promise<Response> {
  const at = machineFor(ctx);
  if (at instanceof Response) return at;
  const refused = ctx.legal(MACHINE, 'state', 'Machines_stop', at.machine.state, 'stopped', String(at.machine.id));
  if (refused) return fail(refused.status, refused.message);
  await ctx.machines.stop(String(at.machine.id));
  await ctx.write(MACHINE, String(at.machine.id), { state: 'stopped', updated_at: ctx.occurredAt, _ports: [] }, 'Machines_stop');
  return Response.json({ ok: true });
}

// source: spec:Machines_start "Start a specific Machine within an app."
export async function Machines_start(ctx: HandlerContext): Promise<Response> {
  const at = machineFor(ctx);
  if (at instanceof Response) return at;
  const commandGap = await admit(ctx, at.machine);
  if (commandGap) return commandGap;
  const refused = ctx.legal(MACHINE, 'state', 'Machines_start', at.machine.state, 'started', String(at.machine.id));
  if (refused) return fail(refused.status, refused.message);
  const previous = at.machine.state;
  const gap = await run(ctx, at.machine);
  if (gap) return gap;
  return Response.json({ previous_state: previous, migrated: false, new_host: '' });
}

// source: spec:Machines_delete "Delete a specific Machine within an app by Machine ID, with an optional force parameter"
export async function Machines_delete(ctx: HandlerContext): Promise<Response> {
  const at = machineFor(ctx);
  if (at instanceof Response) return at;
  const force = new URL(ctx.call.request.url).searchParams.get('force') === 'true';
  // Where the documentation stops: a started machine is destroyed only with force; the refusal is the twin's
  if (at.machine.state === 'started' && !force) return fail(412, 'failed_precondition: unable to destroy machine, not currently stopped or suspended');
  return destroy(ctx, at.machine, 'Machines_delete');
}



// source: spec:Volumes_list "List all volumes associated with a specific app."
export async function Volumes_list(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  if (app instanceof Response) return app;
  return Response.json(ctx.rowsRaw(VOLUME).filter((v) => v._app === app.name && v.state !== 'destroyed').map((v) => volumeView(ctx, v)));
}

// source: spec:Volumes_create "Create a volume for a specific app using the details provided in the request body."
export async function Volumes_create(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  if (app instanceof Response) return app;
  const b = obj(ctx.body);
  if (typeof b.name !== 'string' || !b.name) return fail(400, 'name is required');
  if (typeof b.region !== 'string' || !b.region) return fail(400, 'region is required');
  const size = Number(b.size_gb ?? 3);
  if (!Number.isInteger(size) || size < 1) return fail(400, 'size_gb must be a positive integer');
  const id = ctx.mint(VOLUME);
  const blocks = size * 262144;
  const volume: Row = {
    id, name: b.name, state: 'created', size_gb: size, region: b.region, zone: `${b.region}-a`, encrypted: b.encrypted !== false, fstype: b.fstype ?? 'ext4',
    attached_machine_id: null, attached_alloc_id: null, created_at: ctx.occurredAt, snapshot_retention: Number(b.snapshot_retention ?? 5), auto_backup_enabled: b.auto_backup_enabled !== false,
    block_size: 4096, blocks, blocks_free: blocks, blocks_avail: blocks, bytes_total: blocks * 4096, bytes_used: 0, host_status: 'ok', type: 'local', host_dedication_key: '', _app: app.name,
  };
  await ctx.write(VOLUME, id, volume, 'Volumes_create');
  return Response.json(volumeView(ctx, ctx.row(VOLUME, id)!));
}

// source: https://docs.fly.io/machines/api/volumes-resource/ "Delete a volume. This action cannot be undone."
export async function Volume_delete(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const app = appFor(ctx, c);
  if (app instanceof Response) return app;
  const v = ctx.row(VOLUME, String(ctx.call.params.volume_id));
  if (!v || v._app !== app.name) return fail(404, 'volume not found');
  const refused = ctx.legal(VOLUME, 'state', 'Volume_delete', v.state, 'pending_destroy', String(v.id));
  if (refused) return fail(refused.status, refused.message);
  if (v.attached_machine_id) return fail(412, 'failed_precondition: volume is attached to a machine');
  await ctx.write(VOLUME, String(v.id), { state: 'pending_destroy', _deleted_at: ctx.occurredAt }, 'Volume_delete');
  return Response.json(volumeView(ctx, ctx.row(VOLUME, String(v.id))!));
}

// source: spec:Apps_list "List all apps with the ability to filter by organization slug."
export async function Apps_list(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  if (c instanceof Response) return c;
  const org = ctx.params.org_slug;
  if (!org) return fail(400, 'org_slug is required');
  if (org !== c.org) return fail(403, 'organization not found or not accessible');
  const apps = ctx.rowsRaw(APP).filter((a) => a.deleted !== true && a._org === org && (!c.app || a.name === c.app)).map((a) => appView(ctx, a));
  return Response.json({ total_apps: apps.length, apps });
}
