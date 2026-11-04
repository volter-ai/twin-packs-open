// Sandboxes: started from a template (its image run idle by the World's machine pool, with the sandbox's env vars),
// listed, and killed by the API or, at the end of its timeout, by E2B (./clock.ts). A sandbox is stored as the list
// answers it (ListedSandbox) with its domain; the create answers the Sandbox schema's fields of it.
import { isMachineCapabilityGap, type HandlerContext, type MachineSpec } from '@volter/world-core';
import { e2bError, ENVD_VERSION, obj, ofTeam, paged, SANDBOX, teamOf, teamRows, TEMPLATE, sandboxAnswer, sandboxCreateFailed } from './shared.ts';

// source: spec:/components/schemas/NewSandbox "Time to live for the sandbox in seconds."
const DEFAULT_TIMEOUT = 15;
// Where the documentation stops: the client id E2B answers (deprecated in the spec) is the twin's fixed one
const CLIENT_ID = '6532622b';

// source: spec:post_sandboxes "Create a sandbox from the template"
export async function post_sandboxes(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  // Where the documentation stops: the messages are the twin's, in E2B's error body
  if (!team) return e2bError(401, 'Invalid API key');
  const b = obj(ctx.body);
  // source: spec:/components/schemas/NewSandbox "Identifier of the required template"
  const template = ctx.rowsRaw(TEMPLATE).find((t) => ofTeam(t, team) && (t.templateID === b.templateID || (Array.isArray(t.aliases) && t.aliases.includes(String(b.templateID)))));
  if (!template) return e2bError(404, `template '${String(b.templateID ?? '')}' not found`);
  const timeout = b.timeout === undefined ? DEFAULT_TIMEOUT : Number(b.timeout);
  // source: spec:/components/schemas/NewSandbox "Time to live for the sandbox in seconds."
  if (!Number.isInteger(timeout) || timeout < 0) return e2bError(400, 'timeout must be a whole number of seconds');
  const envVars = Object.fromEntries(Object.entries(obj(b.envVars)).map(([k, v]) => [k, String(v)]));
  const id = ctx.mint(SANDBOX);
  const machineSpec: MachineSpec = { name: id, image: String(template._image), env: envVars, ports: ctx.machines.kind === 'light' ? [] : [49983, 49999], startTimeoutMs: 60_000, signal: ctx.call.request.signal, ...(Array.isArray(template._command) ? { command: template._command.map(String) } : {}) };
  // Architecture, "Other wires: … machines": an unsupported template command creates no sandbox.
  try { if (template._image !== undefined) await ctx.machines.admitRun?.(machineSpec); }
  catch (error) { if (isMachineCapabilityGap(error)) return ctx.gap(); }
  const alias = (template.aliases as string[] | undefined)?.[0];
  await ctx.write(SANDBOX, id, {
    templateID: template.templateID, ...(alias ? { alias } : {}), sandboxID: id, clientID: CLIENT_ID,
    startedAt: ctx.occurredAt, endAt: new Date(Date.parse(ctx.occurredAt) + timeout * 1000).toISOString(),
    cpuCount: template.cpuCount, memoryMB: template.memoryMB, diskSizeMB: template.diskSizeMB,
    // source: spec:/components/schemas/SandboxMetadata "Metadata of the sandbox"
    metadata: Object.fromEntries(Object.entries(obj(b.metadata)).map(([k, v]) => [k, String(v)])),
    state: 'running', envdVersion: template.envdVersion ?? ENVD_VERSION, domain: 'e2b.app', _team: team.id,
    // source: spec:/components/schemas/NewSandbox "Automatically pauses the sandbox after the timeout"
    _autoPause: b.autoPause === true, _autoResume: obj(b.autoResume).enabled === true, _timeout: timeout,
    ...(b.secure === true ? { _envdAccessToken: await ctx.secret(`envd:${id}`) } : {}),
  }, 'post_sandboxes');
  // the sandbox's machine: the template's image, idle until a process starts in it (a template a vendor-backed root read
  // back names no image: its sandbox's machine is the vendor's)
  if (template._image !== undefined || ctx.machines.kind === 'light') try {
    if (template._image === undefined) throw new Error('template has no enrolled guest image');
    // source: https://raw.githubusercontent.com/e2b-dev/E2B/main/packages/js-sdk/src/connectionConfig.ts "export const REQUEST_TIMEOUT_MS = 60_000"
    // The SDK's default request budget is 60_000 ms (also e2b@2.45.0 ConnectionConfig).
    await ctx.machines.run(machineSpec);
  } catch (error) {
    if (isMachineCapabilityGap(error)) return ctx.gap();
    return sandboxCreateFailed(ctx, id, error);
  }
  return Response.json(sandboxAnswer(ctx, ctx.row(SANDBOX, id)!), { status: 201 });
}

// source: spec:get_v2_sandboxes "List all sandboxes"
export async function get_v2_sandboxes(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  if (!team) return e2bError(401, 'Invalid API key');
  const q = new URL(ctx.call.request.url).searchParams;
  // source: spec:get_v2_sandboxes "Filter sandboxes by one or more states"
  const states = q.get('state')?.split(',').filter(Boolean);
  // source: spec:get_v2_sandboxes "Metadata query used to filter the sandboxes"
  const metadata = [...new URLSearchParams(q.get('metadata') ?? '')];
  // source: spec:get_v2_sandboxes "Filter sandboxes by a template ID or alias."
  const template = q.get('template');
  // source: spec:get_v2_sandboxes "Return sandboxes started at or after this timestamp."
  const after = q.get('startedAfter');
  // source: spec:get_v2_sandboxes "Sort direction by sandbox start time. Defaults to desc (newest first)."
  const order = q.get('order') === 'asc' ? 1 : -1;
  const items = teamRows(ctx, SANDBOX, team)
    .filter((s) => !states?.length || states.includes(String(s.state)))
    .filter((s) => metadata.every(([k, v]) => obj(s.metadata)[k] === v))
    .filter((s) => !template || s.templateID === template || s.alias === template)
    .filter((s) => !after || Date.parse(String(s.startedAt)) >= Date.parse(after))
    .sort((a, b) => order * (Date.parse(String(a.startedAt)) - Date.parse(String(b.startedAt))))
    // the list answers ListedSandbox, which names no domain
    .map(({ domain: _domain, ...listed }) => listed);
  return paged(ctx, items, 'sandboxID');
}

// source: spec:delete_sandboxes_sandboxid "Kill a sandbox"
export async function delete_sandboxes_sandboxid(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  if (!team) return e2bError(401, 'Invalid API key');
  const id = String(ctx.call.params.sandboxID);
  const sb = ctx.row(SANDBOX, id);
  // a sandbox already killed is gone: E2B answers it as one it does not know
  // source: spec:delete_sandboxes_sandboxid "Kill a sandbox"
  if (!sb || !ofTeam(sb, team)) return e2bError(404, `sandbox '${id}' not found`);
  await ctx.machines.remove(id);
  await ctx.remove(SANDBOX, id, 'delete_sandboxes_sandboxid');
  // source: spec:delete_sandboxes_sandboxid "The sandbox was killed successfully"
  return new Response(null, { status: 204 });
}

// source: spec:post_sandboxes_sandboxid_connect "Returns sandbox details. If the sandbox is paused, it will be resumed. TTL is only extended."
export async function post_sandboxes_sandboxid_connect(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  if (!team) return e2bError(401, 'Invalid API key');
  const id = String(ctx.call.params.sandboxID), sb = ctx.row(SANDBOX, id);
  if (!sb || !ofTeam(sb, team)) return e2bError(404, 'sandbox not found');
  const timeout = Number(obj(ctx.body).timeout);
  if (!Number.isInteger(timeout) || timeout < 0) return e2bError(400, 'timeout must be a whole number of seconds');
  const paused = sb.state === 'paused';
  if (paused) {
    const refusal = ctx.legal(SANDBOX, 'state', 'post_sandboxes_sandboxid_connect', 'paused', 'running', id);
    if (refusal) return ctx.refuse(refusal);
    await ctx.machines.resume(id);
  }
  const requested = Date.parse(ctx.occurredAt) + timeout * 1000;
  const endAt = new Date(Math.max(requested, paused ? requested : Date.parse(String(sb.endAt)))).toISOString();
  await ctx.write(SANDBOX, id, { state: 'running', endAt, _timeout: timeout }, 'post_sandboxes_sandboxid_connect');
  return Response.json(sandboxAnswer(ctx, ctx.row(SANDBOX, id)!), { status: paused ? 201 : 200 });
}

// source: spec:post_sandboxes_sandboxid_timeout "Calling this method multiple times overwrites the TTL, each time using the current timestamp as the starting point to measure the timeout duration."
export async function post_sandboxes_sandboxid_timeout(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  if (!team) return e2bError(401, 'Invalid API key');
  const id = String(ctx.call.params.sandboxID), sb = ctx.row(SANDBOX, id);
  if (!sb || !ofTeam(sb, team)) return e2bError(404, 'sandbox not found');
  const timeout = Number(obj(ctx.body).timeout);
  if (!Number.isInteger(timeout) || timeout < 0) return e2bError(400, 'timeout must be a whole number of seconds');
  await ctx.write(SANDBOX, id, { endAt: new Date(Date.parse(ctx.occurredAt) + timeout * 1000).toISOString(), _timeout: timeout }, 'post_sandboxes_sandboxid_timeout');
  return new Response(null, { status: 204 });
}
