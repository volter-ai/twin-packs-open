// reddit.com — Reddit's bare domain, which sends every request to the same path on www.reddit.com (a permanent move):
// the videogame.ai site's share link names https://reddit.com/submit, which a browser follows there.
// Where the documentation stops: Reddit documents no answer for its bare domain; the move is the browser's observed
// one (reddit.com/submit opening www.reddit.com/submit), and its status a permanent redirect.
import type { HandlerContext } from '@volter/world-core';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  return new Response(null, { status: 301, headers: { location: `https://www.reddit.com${url.pathname}${url.search}` } });
}
