// The dev browser, the `/dev_browser` family: what clerk-js asks a development instance for before anything else.
import type { HandlerContext } from '@volter/world-core';
import { sha256 } from './shared.ts';

/** `POST /v1/dev_browser`: "Generate a Dev Browser API token. This is used to authenticate Development Instances with the
 *  `DevBrowser` scheme. It must be set before making any request to a dev instance, even for endpoints that are public."
 *  The spec gives the answer no schema; clerk-js reads its `token`. The twin names the browser by its `__client` cookie,
 *  so the token identifies nothing and is stored nowhere; it is derived from the instant, never drawn. */
export async function createDevBrowser(ctx: HandlerContext): Promise<Response> {
  // drawn from a secret the World holds (ctx.secret): a dev browser token names a browser's client
  const token = `dvb_${sha256(await ctx.secret(`dev_browser:${ctx.occurredAt}`)).slice(0, 27)}`;
  return ctx.reply({ object: 'dev_browser', id: token, token });
}
