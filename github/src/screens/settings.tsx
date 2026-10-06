// A PERSON'S NEW GITHUB APP FROM A MANIFEST — github.com/settings/apps/new (a hosted flow): the App registered under
// the person signed in (screens/shared.tsx, manifestFlow).
import type { HandlerContext } from '@volter/world-core';
import { manifestFlow, refused } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  if (path !== '/settings/apps/new' || ctx.call.request.method !== 'POST') return refused(404, 'Not Found');
  return manifestFlow(ctx, undefined, '/settings/apps/new');
}
