// The World's doors (architecture, "Doors, screens and the gap"): what the vendor's own pages do that its API does
// not, each declared in the manifest's `doors` (its id, method and path under `/_twin/`) and answered here by the
// export its id names, over the contract's context.
import type { HandlerContext } from '@volter/world-core';
import { privateTransportKey } from '@volter/world-core';
import type { ServerConfiguration } from '../engine/configuration.ts';
import { servedReadonly, SOURCE_POLICY_HEADER } from '../engine/user-policy.ts';

export type { HandlerContext };

type SourceUsers = Pick<ServerConfiguration, 'users' | 'userPolicies'>;
function sameUsers(left: SourceUsers, right: SourceUsers): boolean {
  for (const field of ['users', 'userPolicies'] as const) {
    const before = left[field] ?? {}, after = right[field] ?? {};
    if (Object.keys(before).length !== Object.keys(after).length) return false;
    for (const name of Object.keys(before)) {
      if (!Object.hasOwn(after, name)) return false;
      if (field === 'users') { if (left.users![name] !== right.users![name]) return false; }
      else if (String(left.userPolicies![name]!.readonly) !== String(right.userPolicies![name]!.readonly)) return false;
    }
  }
  return true;
}

export async function configuration(ctx: HandlerContext): Promise<Response> {
  const body = ctx.body as ServerConfiguration;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['clusters', 'users', 'userPolicies', 'macros', 'localReplication', 'systemLogs'].includes(key))) return new Response('Invalid configuration', { status: 400 });
  for (const map of [body.clusters, body.users, body.userPolicies, body.macros]) if (map !== undefined && (!map || typeof map !== 'object' || Array.isArray(map))) return new Response('Invalid configuration map', { status: 400 });
  for (const [name, replicas] of Object.entries(body.clusters ?? {})) if (!name || !Array.isArray(replicas) || replicas.length !== 1 || replicas[0] !== 'local') return new Response('One local shard is supported; remote fanout is not configured', { status: 400 });
  for (const [user, password] of Object.entries(body.users ?? {})) if (!user || typeof password !== 'string') return new Response('Invalid user', { status: 400 });
  for (const [user, policy] of Object.entries(body.userPolicies ?? {})) if (!user || (body.users ? !Object.hasOwn(body.users, user) : user !== 'default')
    || !policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).length !== 1 || !Object.hasOwn(policy, 'readonly'))
    return new Response('Invalid user policy', { status: 400 });
  try { for (const policy of Object.values(body.userPolicies ?? {})) policy.readonly = servedReadonly(policy.readonly); }
  catch (error) { return new Response(error instanceof Error ? error.message : 'Invalid user policy', { status: 400 }); }
  for (const [name, value] of Object.entries(body.macros ?? {})) if (!name || typeof value !== 'string') return new Response('Invalid macro', { status: 400 });
  if (body.localReplication !== undefined && typeof body.localReplication !== 'boolean') return new Response('Invalid replication configuration', { status: 400 });
  if (body.systemLogs !== undefined && body.systemLogs !== 'disabled') return new Response('Enabled system logs are not implemented', { status: 400 });
  const sourceKey = ctx.call.request.headers.get(SOURCE_POLICY_HEADER);
  if (sourceKey !== null && sourceKey !== privateTransportKey('clickhouse-source-policy')) return new Response('Invalid source installation capability', { status: 403 });
  // The immutable anchor survives every subsequent configuration record, including updates that omit users.
  const installed = ctx.rows('_configuration').map(row => ctx.own(row)).reverse().find(row => row.sourceUsers !== undefined)?.sourceUsers as SourceUsers | undefined;
  const supplied: SourceUsers = { users: body.users, userPolicies: body.userPolicies };
  const sourceUsers = installed ?? (sourceKey !== null ? supplied : undefined);
  if (sourceKey !== null && (body.users === undefined || body.userPolicies === undefined)) return new Response('Source installation requires users and their policies', { status: 400 });
  if (installed && !sameUsers(installed, {
    users: body.users ?? installed.users, userPolicies: body.userPolicies ?? installed.userPolicies,
  })) return new Response('Configuration conflicts with the installed original users or policies', { status: 400 });
  await ctx.record('_configuration', sourceUsers ? { ...body, ...sourceUsers, sourceUsers } : body, 'server', 'configuration');
  return Response.json({ configured: true });
}
