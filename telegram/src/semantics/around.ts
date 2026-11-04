// What the Bot API does around every request (architecture, around.ts): the token in the path names the bot before the
// method is routed, as the server's client manager reads it. A token of a form BotFather never issues is refused as
// invalid; one it did not issue, or one made again since (BotFather's /token revokes the token before), as
// unauthorized. A path that names no bot at all is not the API's.
import type { HandlerContext } from '@volter/world-core';
import { botOfToken, refuse, SERVED_METHODS, tokenOf } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname;
  if (path.startsWith('/_twin/') || path === '/twin' || path.startsWith('/twin/')) return next();
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/HttpConnection.cpp "if (!url_path_parser.try_skip("
  const token = tokenOf(ctx.call.request);
  if (token === undefined) return refuse(ctx, 404, 'Not Found');
  const found = botOfToken(ctx, token);
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/ClientManager.cpp "Unauthorized: invalid token specified"
  if (found === 'invalid') return refuse(ctx, 401, 'Unauthorized: invalid token specified');
  // a token the bot does not hold fails its login
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "result.code = 401;"
  if (found === 'unknown') return refuse(ctx, 401, 'Unauthorized');
  // a method asked by GET, or named in another case, is the same method: the server takes both methods and lowers the
  // name before it routes
  // source: https://core.telegram.org/bots/api#making-requests "We support GET and POST HTTP methods."
  // source: https://core.telegram.org/bots/api#making-requests "All methods in the Bot API are case-insensitive."
  const method = /^\/bot[^/]+\/([^/]+)$/.exec(path)?.[1];
  const canonical = method ? SERVED_METHODS.find((m) => m.toLowerCase() === method.toLowerCase()) : undefined;
  if (method && (ctx.call.request.method === 'GET' || (canonical && canonical !== method))) {
    const url = new URL(ctx.call.request.url);
    if (canonical) url.pathname = path.slice(0, path.length - method.length) + canonical;
    const body = ctx.call.request.method === 'GET' ? undefined : await ctx.call.request.clone().arrayBuffer();
    return next(new Request(url, { method: 'POST', headers: ctx.call.request.headers, ...(body ? { body } : {}) }));
  }
  return next();
}
