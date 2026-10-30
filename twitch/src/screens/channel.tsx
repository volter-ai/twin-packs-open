// A channel's page on twitch.tv (a workspace): www.twitch.tv/<login>, what a viewer watches the broadcast on and chats
// in. The owner's ruling of 2026-10-07: "the main focus of the twitch pack should be the UI mirror of course. And the
// fact that you can actually video cast to it".
//
//   GET  /<login>   the player (world-ui's LivePlayer: the broadcast while the channel is live, else the offline words,
//                   until its next broadcast starts), under it the channel: its name, the LIVE badge, the title and
//                   category, the viewer count and how long it has been live; beside it the chat. The channel's details
//                   and its chat are LiveRegions: they change on an open page as the channel goes live or offline, its
//                   viewers come and go, and messages land
//   GET  /<login>?live=chat|info&after=<cursor>   a region's held read (world-ui's liveFragment)
//   POST /<login>   the chat box's "Chat": the message sent to the channel's chat as the person logged in (a visitor is
//                   sent to log in first), then back to the page (with Twitch's words for a refusal, `chat_error`)
//
// What the page shows it reads through Twitch's API as its own client does (Get Users, Get Channel Information, Get
// Streams), and a message is Send Chat Message, made as the person (./shared.tsx `asOperation`).
import type { HandlerContext } from '@volter/world-core';
import { liveFragment, LiveRegion } from '@volter/world-ui';
import { getChannelInformation } from '../semantics/channels.ts';
import { sendChatMessage } from '../semantics/chat.ts';
import { getStreams } from '../semantics/streams.ts';
import { getUsers } from '../semantics/users.ts';
import { answered, asOperation, Avatar, ChatPanel, chatFragment, firstOf, linkTo, notFoundPage, personOn, Player, postChat, shownError, twitchPage, type Row } from './shared.tsx';

/** How long a stream has been live, as the channel page counts it (hours:minutes:seconds). */
function uptime(startedAt: string, now: string): string {
  const s = Math.max(0, Math.floor((Date.parse(now) - Date.parse(startedAt)) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** What the page knows of the channel: its information and its live stream, read through the API. */
async function channelState(ctx: HandlerContext, user: Row, person: Row | undefined): Promise<{ channel: Row; stream: Row | undefined }> {
  const channel = firstOf((await answered(getChannelInformation(asOperation(ctx, 'getChannelInformation', person, { query: { broadcaster_id: String(user.id) } })))).body) ?? {};
  // source: spec:/paths/~1streams/get/parameters/1/description "Returns only the streams of those users that are broadcasting."
  const stream = firstOf((await answered(getStreams(asOperation(ctx, 'getStreams', person, { query: { user_id: String(user.id) } })))).body);
  return { channel, stream };
}

/** The channel's details under the player: name, LIVE, title, category, viewers and uptime. */
function Info({ ctx, user, channel, stream }: { ctx: HandlerContext; user: Row; channel: Row; stream: Row | undefined }) {
  const title = String((stream ?? channel).title ?? '');
  const category = String((stream ?? channel).game_name ?? '');
  return (
    <>
      <Avatar user={user} size={64} />
      <div>
        <h1>{String(user.display_name)}{stream ? <> <span className="live-badge">Live</span></> : null}</h1>
        {title ? <div className="title">{title}</div> : null}
        {category ? <div className="category">{category}</div> : null}
      </div>
      {stream
        ? <div className="stats"><div className="viewers" title="Viewers">{String(stream.viewer_count)} viewers</div><div className="uptime">{uptime(String(stream.started_at), ctx.occurredAt)}</div></div>
        : null}
    </>
  );
}

/** Where the details stand: what they show, but the uptime (which moves every second without any write). */
const infoCursor = (channel: Row, stream: Row | undefined): string => JSON.stringify([stream?.id ?? null, stream?.viewer_count ?? null, (stream ?? channel).title ?? '', (stream ?? channel).game_name ?? '']);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const login = String((ctx.call.params as Row).login ?? '').toLowerCase();
  const person = personOn(ctx);
  const user = firstOf((await answered(getUsers(asOperation(ctx, 'getUsers', person, { query: { login } })))).body);
  if (!user) return notFoundPage(ctx, person);
  const chat = chatFragment(ctx, user);
  if (chat) return chat;
  const info = liveFragment(ctx, 'info', {
    resources: ['stream', 'channel'],
    cursor: () => { const c = ctx.rowsRaw('channel').find((r) => r.broadcaster_id === user.id) ?? {}; const s = ctx.rowsRaw('stream').find((r) => r.user_id === user.id && r.deleted !== true); return infoCursor(c, s); },
    render: () => { const c = ctx.rowsRaw('channel').find((r) => r.broadcaster_id === user.id) ?? {}; const s = ctx.rowsRaw('stream').find((r) => r.user_id === user.id && r.deleted !== true); return <Info ctx={ctx} user={user} channel={c} stream={s} />; },
  });
  if (info) return info;
  const here = linkTo('www.twitch.tv', `/${String(user.login)}`, ctx);
  if (ctx.call.request.method === 'POST') return postChat(ctx, user, person, here, sendChatMessage);
  const error = shownError(ctx, 'chat_error');
  const { channel, stream } = await channelState(ctx, user, person);
  return twitchPage(ctx, {
    title: `${String(user.display_name)} - Twitch`, ...(person ? { person } : {}),
    body: (
      <div className="layout">
        <main className="main">
          <Player ctx={ctx} user={user} stream={stream} />
          <LiveRegion name="info" as="section" cursor={infoCursor(channel, stream)} className="channel-info" label="Channel">
            <Info ctx={ctx} user={user} channel={channel} stream={stream} />
          </LiveRegion>
        </main>
        <ChatPanel ctx={ctx} broadcaster={user} action={here} {...(person ? { person } : {})} {...(error ? { error } : {})} />
      </div>
    ),
  });
}
