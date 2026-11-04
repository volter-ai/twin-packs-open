// The channels family: channels.list, the channel a studio's tooling reads first (its id, its title, its statistics).
import type { HandlerContext } from '@volter/world-core';
import { CHANNEL, VIDEO, answerOf, callerOf, idOf, listAnswer, listParam, maxResultsOf, obj, offsetFor, partsOf, query, refuse, tokenOf, type Row } from './shared.ts';

/** A channel's statistics as YouTube computes them: the views of all its videos and the count of its public ones. */
function withStatistics(ctx: HandlerContext, channel: Row): Row {
  const id = idOf(ctx, channel);
  const videos = ctx.rowsRaw(VIDEO).filter((v) => v.deleted !== true && v._channel === id);
  // source: https://developers.google.com/youtube/v3/docs/channels "The sum of the number of times all the videos in all formats have been viewed for a channel."
  const views = videos.reduce((n, v) => n + Number(obj(ctx.own(v).statistics).viewCount ?? 0), 0);
  // source: https://developers.google.com/youtube/v3/docs/channels "Note that the value reflects the count of"
  const count = videos.filter((v) => obj(ctx.own(v).status).privacyStatus === 'public' && obj(ctx.own(v).status).uploadStatus === 'processed').length;
  const stats = obj(ctx.own(channel).statistics);
  return { ...channel, statistics: { viewCount: String(views), subscriberCount: String(stats.subscriberCount ?? '0'), hiddenSubscriberCount: stats.hiddenSubscriberCount === true, videoCount: String(count) } };
}

// source: https://developers.google.com/youtube/v3/docs/channels/list "A maximum of one of the following filters may be specified:"
export async function youtube_channels_list(ctx: HandlerContext): Promise<Response> {
  const parts = partsOf(ctx);
  const ids = listParam(ctx, 'id');
  const mine = ctx.flag(query(ctx, 'mine')) === true;
  const filters = [ids.length > 0, mine].filter(Boolean).length;
  if (filters !== 1) return refuse(ctx, 400, 'youtube.parameter', 'invalidCriteria', 'A maximum of one of the following filters may be specified: id, categoryId, mine, managedByMe, forHandle, forUsername.');
  const size = maxResultsOf(ctx, 5, 0, 50);
  if (size instanceof Response) return size;
  const offset = offsetFor(ctx);
  if (offset instanceof Response) return offset;
  let rows: Row[];
  if (mine) {
    // source: https://developers.google.com/youtube/v3/docs/errors "The request uses the mine parameter but is not properly authorized."
    // Where the documentation stops: the page names the reason (authorizationRequired, 401) and not its domain; the twin
    // answers it in YouTube's parameter domain
    if (!tokenOf(ctx)) return refuse(ctx, 401, 'youtube.parameter', 'authorizationRequired', 'The request uses the mine parameter but is not properly authorized.');
    const caller = callerOf(ctx);
    if (caller instanceof Response) return caller;
    rows = ctx.rowsRaw(CHANNEL).filter((c) => c.deleted !== true && c._sub === caller.sub);
  } else {
    rows = ids.map((id) => ctx.row(CHANNEL, id)).filter((c): c is Row => !!c && c.deleted !== true);
  }
  // Where the documentation stops: the page names channelNotFound for an id it cannot find; a list naming several ids
  // answers those it finds, and an empty list when the account has no channel.
  return listAnswer(ctx, 'youtube#channelListResponse', rows.map((c) => answerOf(ctx, withStatistics(ctx, c), parts)), offset, size);
}
