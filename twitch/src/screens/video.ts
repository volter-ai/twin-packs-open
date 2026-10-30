// Twitch's playback host (a content screen, docs/contributing/architecture.md "Other wires": live media): a channel's
// broadcasts as HLS, answered from what the World recorded when the channel's encoder published to the ingest
// (../semantics/live.ts). The player on its pages (world-ui's LivePlayer: ./shared.tsx `Player`) is given a broadcast's
// media playlist here.
//
//   GET /api/channel/hls/<login>/<broadcast>/index.m3u8   the broadcast's media playlist: its live window while it is
//                                                         live, the whole broadcast once it ended
//   GET /api/channel/hls/<login>/<broadcast>/init-<n>.mp4, seg-<n>.m4s   its init and its segments, as the kernel keeps them
//
// `<broadcast>` is a broadcast's stream id, or `after-<stream id>` (`after-0` for none): the channel's first broadcast
// after that one, so a page opened while the channel is offline plays its next broadcast when it starts (and 404s until
// then, while the player waits). A bandwidth test is never played ("disables live viewing of the stream").
//
// Where the documentation stops: Twitch does not document its playback host. usher.ttvnw.net and its
// /api/channel/hls/ path are where twitch.tv's own player asks for a channel's broadcast; the twin's playback URLs name
// the broadcast they play, and it serves no playback access token, no other rendition and no ads.
import type { HandlerContext } from '@volter/world-core';
import { broadcastsOf, userByLogin } from '../semantics/shared.ts';

const FILE = /^\/api\/channel\/hls\/([a-z0-9_]{1,25})\/(after-)?(\d{1,20})\/(index\.m3u8|init-\d{1,9}\.mp4|seg-\d{1,12}\.m4s)$/;
const notFound = (): Response => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const file = FILE.exec(new URL(request.url).pathname);
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !file) return notFound();
  const user = userByLogin(ctx, file[1]!);
  const broadcasts = user ? broadcastsOf(ctx, String(user.id)) : [];
  const at = broadcasts.indexOf(file[3]!);
  const stream = file[2] ? (file[3] === '0' ? broadcasts[0] : at >= 0 ? broadcasts[at + 1] : undefined) : at >= 0 ? file[3] : undefined;
  return stream ? ctx.live.serve(stream, file[4]!) : notFound();
}
