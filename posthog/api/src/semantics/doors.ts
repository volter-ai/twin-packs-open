// The World's doors (architecture, "Doors, screens and the gap"): what PostHog's project settings do that its API does
// not, each declared in the manifest's `doors` and answered by the export its id names.
//
//   POST /_twin/app-credentials   the application's project, its project token and a personal API key, the same at
//                                 every boot (the descriptor's credentialDoor)
import type { HandlerContext } from '@volter/world-core';
import { makeProject, personalKey } from './shared.ts';

/** Bootstrap (RECIPE, State): the account's sign-up makes its first project with its project token, and a personal API
 *  key (Settings > Personal API keys) with the scopes the application's erasure needs, answered the same every boot. */
// source: https://posthog.com/docs/api "Personal API keys"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  const name = account === 'default' ? 'Default project' : `world-${ctx.crypto.sha256(account).slice(0, 24)}`;
  const { project, token } = await makeProject(ctx, name);
  // Rallly's erasure "needs the person:write scope" (apps/web/src/lib/posthog.ts); the bench's export reads events
  const key = await personalKey(ctx, project, 'world-app', ['person:write', 'query:read']);
  return Response.json({
    project_id: String(project.id), project_token: token, personal_api_key: key,
    ingest_host: 'https://us.i.posthog.com', api_host: 'https://us.posthog.com',
  }, { status: 201 });
}
