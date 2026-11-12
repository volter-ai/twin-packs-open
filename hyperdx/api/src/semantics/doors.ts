// The World's doors (architecture, "Doors, screens and the gap"): what HyperDX's team sign-up and settings do that its
// API does not, each declared in the manifest's `doors` and answered by the export its id names.
//
//   POST /_twin/app-credentials   the World's team, its ingestion API key and the application's personal API key, the
//                                 same at every boot (the descriptor's credentialDoor)
import type { HandlerContext } from '@volter/world-core';
import { ACCESS_KEY, keyValue, objectId, TEAM } from './shared.ts';

/** Bootstrap (RECIPE, State): the account's sign-up makes its team (HyperDX sets a new team up with its Logs and Traces
 *  sources), the team's ingestion API key and its first user's personal API key (Team Settings), answered the same
 *  every boot. */
// source: spec:searchEvents "Authentication: Bearer token (personal API key from Team Settings)."
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/models/team.ts "apiKey: {"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  let team = ctx.rowsRaw(TEAM).find((t) => t.deleted !== true && t.account === account);
  if (!team) {
    const id = objectId(ctx, `team:${await ctx.secret(`hyperdx-team:${account}`)}`);
    await ctx.record(TEAM, { id, account, name: account === 'default' ? 'My Team' : `world-${ctx.crypto.sha256(account).slice(0, 24)}`, created_at: ctx.occurredAt }, id, 'team.create');
    team = ctx.rowsRaw(TEAM).find((t) => t.deleted !== true && t.account === account)!;
  }
  const teamId = String(team.id);
  const accessKey = await keyValue(ctx, `hyperdx-access-key:${teamId}`);
  const ingestionKey = await keyValue(ctx, `hyperdx-ingestion-key:${teamId}`);
  const hash = ctx.crypto.digest('sha256', accessKey, 'hex');
  if (!ctx.rowsRaw(ACCESS_KEY).some((k) => k.deleted !== true && k.sha256 === hash)) {
    await ctx.record(ACCESS_KEY, { team: teamId, sha256: hash, created_at: ctx.occurredAt }, undefined, 'access_key.create');
  }
  return Response.json({
    team_id: teamId, access_key: accessKey, ingestion_key: ingestionKey,
    api_url: 'https://api.hyperdx.io', ingest_url: 'https://in-otel.hyperdx.io',
  }, { status: 201 });
}
