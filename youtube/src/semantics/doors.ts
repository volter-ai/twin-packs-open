// The World's doors (architecture, "Doors, screens and the gap"): what YouTube's own pages and its audience do that its
// API does not.
//
//   POST /_twin/channels { sub, title, handle?, description? }        a Google account's YouTube channel (its sign-up;
//                                                                     the credential door, for the World's person)
//   POST /_twin/videos/{id}/audience { views?, likes?, comment? }     the audience at work on a video
//   POST /_twin/live-chats/{liveChatId}/audience { author, text }     a chat line from someone outside the World
//   POST /_twin/channels/{id}/audience { subscribers }                the channel's subscribers
//
// The Google account a channel belongs to is Google OAuth's (its own account door makes it, by its 21-digit sub); the
// channel door is the step YouTube asks of an account before it uploads or streams. An author outside the World is a
// YouTube channel of no Google account the World holds, made the first time it speaks.
import type { HandlerContext } from '@volter/world-core';
import { googleSubFor } from '@volter/twin-googleoauth/google-account-id';
import { CHANNEL, THREAD, VIDEO, bodyObject, chatById, chatEnded, live, obj, postChatMessage, writeComment, type Row } from './shared.ts';

const bad = (error: string, status = 400): Response => Response.json({ error }, { status });

/** A channel's thumbnails, a placeholder avatar at YouTube's sizes. */
// Where the documentation stops: the pages give a channel thumbnail's sizes, not its URL's form; the twin answers
// URLs on YouTube's image host, which the World does not serve.
// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The default thumbnail for a channel is 88px wide and 88px tall."
const avatar = (id: string): Row => ({
  default: { url: `https://yt3.ggpht.com/ytc/${id}=s88-c-k-c0x00ffffff-no-rj`, width: 88, height: 88 },
  medium: { url: `https://yt3.ggpht.com/ytc/${id}=s240-c-k-c0x00ffffff-no-rj`, width: 240, height: 240 },
  high: { url: `https://yt3.ggpht.com/ytc/${id}=s800-c-k-c0x00ffffff-no-rj`, width: 800, height: 800 },
});

/** A channel as YouTube's sign-up makes it. */
async function makeChannel(ctx: HandlerContext, title: string, handle: string | undefined, description: string, sub: string | undefined): Promise<Row> {
  const made = await ctx.createUnique(CHANNEL, id => ({
    kind: 'youtube#channel', id,
    snippet: { title, description, ...(handle ? { customUrl: `@${handle.replace(/^@/, '').toLowerCase()}` } : {}), publishedAt: ctx.occurredAt, thumbnails: avatar(id), localized: { title, description } },
    // source: https://developers.google.com/youtube/v3/docs/channels "The ID of the playlist that contains the channel's uploaded videos."
    // Where the documentation stops: the uploads playlist's id is the channel's with UU for UC (playlistItems is the gap).
    contentDetails: { relatedPlaylists: { likes: '', uploads: `UU${id.slice(2)}` } },
    statistics: { viewCount: '0', subscriberCount: '0', hiddenSubscriberCount: false, videoCount: '0' },
    status: { privacyStatus: 'public', isLinked: true, longUploadsStatus: 'allowed', madeForKids: false },
    ...(sub ? { _sub: sub } : { _audience: true }),
  }), 'channel.create');
  return ctx.row(CHANNEL, String(made.row.id))!;
}

/** The channel of an author outside the World, by the name it speaks under. */
async function audienceChannel(ctx: HandlerContext, name: string): Promise<Row> {
  const held = ctx.rowsRaw(CHANNEL).find((c) => c.deleted !== true && c._audience === true && obj(ctx.own(c).snippet).title === name);
  return held ?? makeChannel(ctx, name, undefined, '', undefined);
}

export async function channels(ctx: HandlerContext): Promise<Response> {
  const b = bodyObject(ctx);
  if (b.account !== undefined || b.deployment !== undefined) {
    const organization = await ctx.organization();
    const email = organization.members[0]!.toLowerCase();
    const sub = googleSubFor(email);
    if (b.sub !== undefined && b.sub !== sub) return bad(`sub does not identify the first member of organization ${organization.id}`);
    const owner = ctx.ownerRow('googleoauth', 'account', sub);
    if (owner && owner.email !== email) return bad(`Google account ${sub} belongs to another email (${organization.id})`, 409);
    const channel = await ctx.tenant(CHANNEL, async () => {
      const made = await makeChannel(ctx, typeof b.title === 'string' && b.title.trim() ? b.title : organization.label, undefined, '', sub);
      return String(made.id);
    });
    if (channel._sub !== sub) return bad(`The retained channel belongs to another Google account (${organization.id})`, 409);
    const v = ctx.own(channel);
    return Response.json({ id: channel.id, sub, title: obj(v.snippet).title, ...(obj(v.snippet).customUrl ? { customUrl: obj(v.snippet).customUrl } : {}) }, { status: 201 });
  }
  if (typeof b.sub !== 'string' || !/^\d{21}$/.test(b.sub)) return bad('sub (the Google account\'s 21-digit id) is required');
  if (typeof b.title !== 'string' || !b.title.trim()) return bad('title is required');
  if (b.handle !== undefined && (typeof b.handle !== 'string' || !/^@?[A-Za-z0-9._-]{3,30}$/.test(b.handle))) return bad('a handle is 3 to 30 letters, digits, dots, dashes and underscores');
  const held = ctx.rowsRaw(CHANNEL).find((c) => c.deleted !== true && c._sub === b.sub);
  // one channel per Google account: asking again answers the one it has
  const channel = held ?? await makeChannel(ctx, b.title, typeof b.handle === 'string' ? b.handle : undefined, typeof b.description === 'string' ? b.description : '', b.sub);
  const v = ctx.own(channel);
  return Response.json({ id: v.id, sub: b.sub, title: obj(v.snippet).title, ...(obj(v.snippet).customUrl ? { customUrl: obj(v.snippet).customUrl } : {}) }, { status: held ? 200 : 201 });
}

export async function videoAudience(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.params.id ?? '');
  const video = live(ctx.row(VIDEO, id));
  if (!video) return bad('no such video', 404);
  const b = bodyObject(ctx);
  const n = (k: string): number => (typeof b[k] === 'number' && Number.isInteger(b[k]) && (b[k] as number) >= 0 ? b[k] as number : 0);
  const v = ctx.own(video);
  const stats = obj(v.statistics);
  const statistics = { ...stats, viewCount: String(Number(stats.viewCount ?? 0) + n('views')), likeCount: String(Number(stats.likeCount ?? 0) + n('likes')) };
  if (n('views') || n('likes')) await ctx.write(VIDEO, id, { statistics }, 'audience');
  const comment = obj(b.comment);
  let thread: string | undefined;
  if (typeof comment.text === 'string' && comment.text.trim()) {
    const author = await audienceChannel(ctx, typeof comment.author === 'string' && comment.author.trim() ? comment.author : 'A viewer');
    thread = ctx.mint(THREAD);
    await ctx.write(THREAD, thread, { kind: 'youtube#commentThread', id: thread, snippet: { channelId: video._channel, videoId: id, canReply: true, isPublic: true }, _video: id, _channel: video._channel }, 'audience');
    await writeComment(ctx, thread, author, ctx.row(VIDEO, id)!, comment.text, 'audience');
  }
  const after = obj(ctx.own(ctx.row(VIDEO, id)!).statistics);
  return Response.json({ id, statistics: after, ...(thread ? { commentThreadId: thread } : {}) });
}

export async function chatAudience(ctx: HandlerContext): Promise<Response> {
  const liveChatId = String(ctx.params.liveChatId ?? '');
  const held = chatById(ctx, liveChatId);
  if (!held || !held.broadcast) return bad('no such live chat', 404);
  if (chatEnded(ctx, held.broadcast)) return bad('the live chat has ended', 409);
  const b = bodyObject(ctx);
  if (typeof b.text !== 'string' || !b.text.trim()) return bad('text is required');
  const author = await audienceChannel(ctx, typeof b.author === 'string' && b.author.trim() ? b.author : 'A viewer');
  const message = await postChatMessage(ctx, liveChatId, held.broadcast, author, b.text, 'audience');
  return Response.json({ id: ctx.own(message).id, liveChatId, authorChannelId: ctx.own(author).id }, { status: 201 });
}

export async function channelAudience(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.params.id ?? '');
  const channel = live(ctx.row(CHANNEL, id));
  if (!channel) return bad('no such channel', 404);
  const b = bodyObject(ctx);
  if (typeof b.subscribers !== 'number' || !Number.isInteger(b.subscribers) || b.subscribers < 0) return bad('subscribers is a whole number');
  // source: https://developers.google.com/youtube/v3/docs/channels "This value is rounded down to three"
  const exact = b.subscribers;
  const digits = String(exact).length;
  const shown = digits <= 3 ? exact : Math.floor(exact / 10 ** (digits - 3)) * 10 ** (digits - 3);
  await ctx.write(CHANNEL, id, { statistics: { ...obj(ctx.own(channel).statistics), subscriberCount: String(shown) } }, 'audience');
  return Response.json({ id, subscriberCount: String(shown) });
}
