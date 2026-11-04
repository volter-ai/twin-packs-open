// A package's dist-tags (npm dist-tag): which version each tag names.
import type { HandlerContext } from '@volter/world-core';
import { mayRead, nameOf, notFound, PACKAGE } from './shared.ts';

/** `GET /-/package/{package}/dist-tags`: `{ tag: version }`. */
// source: https://raw.githubusercontent.com/npm/cli/v10.9.8/lib/commands/dist-tag.js "`/-/package/${spec.escapedName}/dist-tags`"
export async function dist_tag_fetchTags(ctx: HandlerContext): Promise<Response> {
  const name = nameOf(ctx.call.params.spec_escapedName);
  const pkg = ctx.row(PACKAGE, name);
  if (!pkg || !mayRead(ctx, name, pkg)) return notFound();
  return Response.json(ctx.own(pkg)['dist-tags'] ?? {});
}
