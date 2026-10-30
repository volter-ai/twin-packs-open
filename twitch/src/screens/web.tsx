// twitch.tv's root and its other hosts (the manifest's `web` screen, a workspace at `/`, the path a World's console
// frames). twitch.tv and m.twitch.tv move to the same page on www.twitch.tv; at www.twitch.tv's root a person logged in
// is sent to their channel and a visitor to the log-in, which returns them there. Where the documentation stops:
// www.twitch.tv's root is Twitch's front page of recommended channels, which the twin does not draw.
//
// player.twitch.tv is this screen's too: Twitch's embedded player (player.twitch.tv/?channel=<login>&parent=<host>), the
// channel's broadcast alone, the player a site puts in an iframe, as Twitch's embed documentation gives it. A
// videogame.ai game page plays its cast this way for a visitor with no account.
//
//   GET  /?channel=<login>&parent=<the embedding page's host>   the player (world-ui's LivePlayer, as the channel page's)
//
// source: https://dev.twitch.tv/docs/embed/video-and-clips/ "?channel=dallas&parent=streamernews.example.com"
// Where the documentation stops: Twitch refuses an embed whose parent is not the embedding page's; the twin plays for any
// parent it is given, and answers Twitch's unavailable page for a missing channel or parent.
import type { HandlerContext } from '@volter/world-core';
import { getUsers } from '../semantics/users.ts';
import { getStreams } from '../semantics/streams.ts';
import { answered, asOperation, firstOf, hostOf, moveTo, notFoundPage, personOn, placeOf, Player, twitchPage } from './shared.tsx';

async function player(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const login = (url.searchParams.get('channel') ?? '').toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(login) || !url.searchParams.get('parent')) return notFoundPage(ctx);
  const user = firstOf((await answered(getUsers(asOperation(ctx, 'getUsers', undefined, { query: { login } })))).body);
  if (!user) return notFoundPage(ctx);
  const stream = firstOf((await answered(getStreams(asOperation(ctx, 'getStreams', undefined, { query: { user_id: String(user.id) } })))).body);
  return twitchPage(ctx, { title: `${String(user.display_name)} - Twitch`, bare: true, body: <main className="embed"><Player ctx={ctx} user={user} stream={stream} /></main> });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  // player.twitch.tv/?channel= is the embedded player (above); at a World's place every host is this one base.
  if (hostOf(ctx.call.request) === 'player.twitch.tv' || url.searchParams.has('channel')) return player(ctx);
  if (placeOf(ctx) === undefined && hostOf(ctx.call.request) !== 'www.twitch.tv') return new Response(null, { status: 301, headers: { location: `https://www.twitch.tv${url.pathname}${url.search}` } });
  const person = personOn(ctx);
  return person ? moveTo('www.twitch.tv', `/${String(person.login)}`, ctx) : moveTo('www.twitch.tv', '/login?redirect=%2F', ctx);
}
