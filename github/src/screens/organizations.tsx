// AN ORGANIZATION'S NEW GITHUB APP FROM A MANIFEST — github.com/organizations/{org}/settings/apps/new (a hosted flow):
// the App registered under the organization by one of its owners (screens/shared.tsx, manifestFlow).
import type { HandlerContext } from '@volter/world-core';
import { manifestFlow, refused } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const m = /^\/organizations\/([^/]+)\/settings\/apps\/new$/.exec(new URL(ctx.call.request.url).pathname.replace(/\/+$/, ''));
  if (!m || ctx.call.request.method !== 'POST') return refused(404, 'Not Found');
  const org = decodeURIComponent(m[1]!);
  if (!ctx.row('org', org)) return refused(404, 'Not Found');
  return manifestFlow(ctx, org, `/organizations/${org}/settings/apps/new`);
}
