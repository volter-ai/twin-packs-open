// The World's doors (architecture, "Doors, screens and the gap"): what the vendor does that its API does not, each
// declared in the manifest's `doors` and answered here by the export its id names.
import type { HandlerContext } from '@volter/world-core';
import { DEFAULT_SIZE, ICON, SUPPORTED_SIZES, validDomain, type Row } from './shared.ts';

// The vendor learns a domain's favicon by fetching the site on the domain's first request and storing it at every
// supported size up to the largest the site's own icons reach; a World fetches no site, so the domains it knows, and the
// largest size each has, are declared here, by the World's seed or a scenario. A size not given is the vendor's default.
// source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.controller.ts "await this.faviconService.storeFavicon(params.domainName);"
// source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.service.ts "for (const targetSize of SUPPORTED_SIZES) {"
export async function declareIcons(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row;
  const icons = Array.isArray(body.icons) ? body.icons as Row[] : undefined;
  if (!icons || icons.length === 0) return Response.json({ error: 'icons: a non-empty array of { domain, size? }' }, { status: 400 });
  const declared: Row[] = [];
  for (const icon of icons) {
    const domain = typeof icon?.domain === 'string' ? icon.domain : '';
    const size = icon?.size === undefined ? DEFAULT_SIZE : Number(icon.size);
    if (!validDomain(domain)) return Response.json({ error: `not a domain the vendor accepts: ${JSON.stringify(icon?.domain)}` }, { status: 400 });
    if (!SUPPORTED_SIZES.includes(size)) return Response.json({ error: `size ${String(icon.size)} is not one of ${SUPPORTED_SIZES.join(', ')}` }, { status: 400 });
    const fields = { domain, size, declaredAt: ctx.occurredAt };
    await ctx.record(ICON, fields, domain, 'icon.declare');
    declared.push(fields);
  }
  return Response.json({ icons: declared });
}
