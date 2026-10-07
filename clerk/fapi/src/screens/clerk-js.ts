import { gap } from '../semantics/gap.ts';
// The clerk-js bundle an instance's Frontend API serves at its loader path (docs/contributing/architecture.md, "Screens":
// a content screen): the published bundle (../../../vendor/clerk-js, its SOURCE.md), byte for byte, through the pack-asset
// seam. clerk-js lazy-loads its sibling chunks from the same directory, so every dist file is served by name, and the
// main bundle for the bare path.
import { oauthProxyError } from '../semantics/shared.ts';
import { packAsset, type HandlerContext } from '@volter/world-core';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const proxyError = oauthProxyError(ctx);
  if (proxyError) return proxyError;
  if (ctx.call.request.method !== 'GET' && ctx.call.request.method !== 'HEAD') return gap(ctx, true);
  // source: https://clerk.com/docs/quickstarts/javascript "/npm/@clerk/clerk-js@6/dist/clerk.browser.js"
  // The versioned and bare package loader paths serve the pinned bundle; other packages remain the gap.
  const path = new URL(ctx.call.request.url).pathname;
  if (!/^\/npm\/@clerk\/clerk-js(?:@[^/]+)?(?:\/|$)/.test(path)) return gap(ctx, true);
  const requested = path.split('/').at(-1) ?? '';
  const safe = /^[A-Za-z0-9._-]+\.js$/.test(requested) ? requested : 'clerk.browser.js';
  const asset = await packAsset('clerk', `vendor/clerk-js/dist/${safe}`, 'vendor/clerk-js/dist/clerk.browser.js');
  if (asset === null) return gap(ctx, true);
  return new Response(asset.body, { status: 200, headers: { 'content-type': 'application/javascript; charset=utf-8' } });
}
