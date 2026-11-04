// The registry's own reads that npm's client does not make: one version of a package, by its number or a dist-tag (a
// program checking what is latest, or resolving a pinned version, without the whole document).
import type { HandlerContext } from '@volter/world-core';
import { mayRead, nameOf, notFound, PACKAGE, type Row } from './shared.ts';

/** `GET /{package}/{version}`: the version's manifest as the document holds it; a tag names the version it points to. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "| version | String | **Path** | ✅         | a version number or `latest`        |"
export async function registry_version(ctx: HandlerContext): Promise<Response> {
  const name = nameOf(ctx.call.params.name);
  const pkg = ctx.row(PACKAGE, name);
  if (!pkg || !mayRead(ctx, name, pkg)) return notFound();
  const asked = nameOf(ctx.call.params.version);
  const version = ((pkg['dist-tags'] as Row | undefined) ?? {})[asked] ?? asked;
  const v = (ctx.own(pkg).versions as Record<string, Row> | undefined)?.[String(version)];
  return v ? Response.json(v) : notFound();
}
