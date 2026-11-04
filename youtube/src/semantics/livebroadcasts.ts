// The liveBroadcasts family: a channel's live event (liveBroadcasts.insert), its broadcasts read back
// (liveBroadcasts.list), bound to the stream an encoder sends (liveBroadcasts.bind), and moved through testing, live and
// complete (liveBroadcasts.transition). Every broadcast has its live chat (snippet.liveChatId) from the moment it is made.
import type { HandlerContext } from '@volter/world-core';
import { BROADCAST, CHAT_MESSAGE, LIVE_CHAT, STREAM, VIDEO, answerOf, bodyObject, callerChannel, channelTitle, idOf, listAnswer, listParam, live, maxResultsOf, moveBroadcast, obj, offsetFor, partsOf, query, refuse, settleBroadcast, videoThumbnails, type Row } from './shared.ts';

const PRIVACY = ['private', 'public', 'unlisted'];
const DOMAIN = 'youtube.liveBroadcast';
const NOT_FOUND = 'The broadcast specified by the id parameter does not exist.';
/** The life-cycle statuses each broadcastStatus filter reads. */
const BY_STATUS: Record<string, string[] | undefined> = {
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "Return current live broadcasts."
  active: ['liveStarting', 'live'],
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "Return broadcasts that have already ended."
  completed: ['complete'],
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "Return broadcasts that have not yet started."
  upcoming: ['created', 'ready', 'testStarting', 'testing'],
  all: undefined,
};

/** The caller's broadcast an id names. */
function ownBroadcast(ctx: HandlerContext, sub: string, id: string | undefined): Row | undefined {
  const row = id ? live(ctx.row(BROADCAST, id)) : undefined;
  return row && row._sub === sub ? row : undefined;
}

// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "Creates a broadcast."
export async function youtube_liveBroadcasts_insert(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const body = bodyObject(ctx);
  const snippet = obj(body.snippet);
  const status = obj(body.status);
  const details = obj(body.contentDetails);
  const monitor = obj(details.monitorStream);
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The liveBroadcast resource must specify the snippet.title property."
  if (typeof snippet.title !== 'string' || snippet.title === '') return refuse(ctx, 400, DOMAIN, 'titleRequired', 'The liveBroadcast resource must specify the snippet.title property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The property's value must be between 1 and 100 characters long."
  if ([...snippet.title].length > 100) return refuse(ctx, 400, DOMAIN, 'invalidTitle', "The liveBroadcast resource did not specify a valid value for the snippet.title property. The property's value must be between 1 and 100 characters long.");
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The property's value can contain up to 5000 characters."
  if (snippet.description !== undefined && (typeof snippet.description !== 'string' || [...snippet.description].length > 5000)) return refuse(ctx, 400, DOMAIN, 'invalidDescription', "The liveBroadcast resource did not specify a valid value for the snippet.description property. The property's value can contain up to 5000 characters.");
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The liveBroadcast resource must specify the snippet.scheduledStartTime property."
  if (snippet.scheduledStartTime === undefined) return refuse(ctx, 400, DOMAIN, 'scheduledStartTimeRequired', 'The liveBroadcast resource must specify the snippet.scheduledStartTime property.');
  const start = Date.parse(String(snippet.scheduledStartTime));
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The scheduled start time must be in the future and close enough to the current date that a broadcast could be reliably scheduled at that time."
  if (Number.isNaN(start) || start < Date.parse(ctx.occurredAt)) return refuse(ctx, 400, DOMAIN, 'invalidScheduledStartTime', 'The liveBroadcast resource contained an invalid value for the snippet.scheduledStartTime property. The scheduled start time must be in the future and close enough to the current date that a broadcast could be reliably scheduled at that time.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The scheduled end time must follow the scheduled start time."
  if (snippet.scheduledEndTime !== undefined && !(Date.parse(String(snippet.scheduledEndTime)) > start)) return refuse(ctx, 400, DOMAIN, 'invalidScheduledEndTime', 'The liveBroadcast resource contained an invalid value for the snippet.scheduledEndTime property. The scheduled end time must follow the scheduled start time.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The liveBroadcast resource must specify a privacy status."
  if (status.privacyStatus === undefined) return refuse(ctx, 400, DOMAIN, 'privacyStatusRequired', 'The liveBroadcast resource must specify a privacy status.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert "The liveBroadcast resource contained an invalid value for the status.privacy_status property."
  if (!PRIVACY.includes(String(status.privacyStatus))) return refuse(ctx, 400, DOMAIN, 'invalidPrivacyStatus', 'The liveBroadcast resource contained an invalid value for the status.privacy_status property.');
  // the broadcast is a video: its id is a video's, and its video is made with it
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "Note that the broadcast represents exactly one YouTube video."
  const id = ctx.mint(VIDEO);
  const liveChatId = ctx.mint(LIVE_CHAT);
  await ctx.record(LIVE_CHAT, { broadcast: id }, liveChatId);
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const fields: Row = {
    kind: 'youtube#liveBroadcast', id,
    snippet: {
      publishedAt: ctx.occurredAt, channelId: idOf(ctx, who.channel), title: snippet.title,
      description: typeof snippet.description === 'string' ? snippet.description : '',
      thumbnails: videoThumbnails(id), scheduledStartTime: new Date(start).toISOString(),
      ...(snippet.scheduledEndTime !== undefined ? { scheduledEndTime: new Date(Date.parse(String(snippet.scheduledEndTime))).toISOString() } : {}),
      isDefaultBroadcast: false,
      // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The ID for the broadcast's YouTube live chat."
      liveChatId,
    },
    status: {
      lifeCycleStatus: 'created', privacyStatus: status.privacyStatus,
      // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The broadcast's recording status."
      recordingStatus: 'notRecording',
      madeForKids: status.selfDeclaredMadeForKids === true,
      ...(typeof status.selfDeclaredMadeForKids === 'boolean' ? { selfDeclaredMadeForKids: status.selfDeclaredMadeForKids } : {}),
    },
    contentDetails: {
      // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "However, when you insert a broadcast , the property is optional and has a default value of true ."
      monitorStream: { enableMonitorStream: flag(monitor.enableMonitorStream, true), broadcastStreamDelayMs: typeof monitor.broadcastStreamDelayMs === 'number' ? monitor.broadcastStreamDelayMs : 0 },
      enableEmbed: flag(details.enableEmbed, true), enableDvr: flag(details.enableDvr, true), recordFromStart: flag(details.recordFromStart, true),
      enableClosedCaptions: flag(details.enableClosedCaptions, false),
      closedCaptionsType: details.enableClosedCaptions === true ? 'closedCaptionsHttpPost' : 'closedCaptionsDisabled',
      // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "The property's default value is rectangular ."
      projection: 'rectangular',
      enableLowLatency: false, latencyPreference: 'normal',
      // Where the documentation stops: the page gives no default for enableAutoStart and enableAutoStop; the twin keeps
      // false when none is given.
      enableAutoStart: flag(details.enableAutoStart, false), enableAutoStop: flag(details.enableAutoStop, false),
    },
    statistics: {},
    _channel: idOf(ctx, who.channel), _sub: who.caller.sub,
  };
  await ctx.write(BROADCAST, id, fields, 'youtube.liveBroadcasts.insert');
  const s = obj(fields.snippet);
  const title = String(s.title);
  const description = String(s.description);
  await ctx.write(VIDEO, id, {
    kind: 'youtube#video', id,
    snippet: {
      publishedAt: ctx.occurredAt, channelId: s.channelId, title, description, thumbnails: s.thumbnails, channelTitle: channelTitle(ctx, who.channel),
      // Where the documentation stops: the pages name no category for a broadcast's video that sets none; 22, as an upload's
      categoryId: typeof snippet.categoryId === 'string' ? snippet.categoryId : '22',
      // source: https://developers.google.com/youtube/v3/docs/videos "Indicates if the video is an upcoming/active live broadcast."
      liveBroadcastContent: 'upcoming', localized: { title, description },
    },
    contentDetails: { duration: 'P0D', dimension: '2d', definition: 'sd', caption: 'false', licensedContent: false, contentRating: {}, projection: 'rectangular' },
    // Where the documentation stops: a broadcast's video names no upload status until it is processed; the twin's starts
    // uploaded, as an upload's, and is processed when the broadcast is complete
    status: { uploadStatus: 'uploaded', privacyStatus: obj(fields.status).privacyStatus, license: 'youtube', embeddable: obj(fields.contentDetails).enableEmbed !== false, publicStatsViewable: true, madeForKids: obj(fields.status).madeForKids === true },
    statistics: { viewCount: '0', likeCount: '0', favoriteCount: '0', commentCount: '0' },
    // source: https://developers.google.com/youtube/v3/docs/videos "The object will only be present in a video resource if the video is an upcoming, live, or completed live broadcast."
    liveStreamingDetails: { scheduledStartTime: s.scheduledStartTime, ...(s.scheduledEndTime ? { scheduledEndTime: s.scheduledEndTime } : {}) },
    _channel: idOf(ctx, who.channel), _sub: who.caller.sub, _broadcast: id,
  }, 'youtube.liveBroadcasts.insert');
  return Response.json(answerOf(ctx, ctx.row(BROADCAST, id)!, parts));
}

// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "Returns a list of YouTube broadcasts that match the API request parameters."
export async function youtube_liveBroadcasts_list(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const ids = listParam(ctx, 'id');
  const mine = ctx.flag(query(ctx, 'mine')) === true;
  const byStatus = query(ctx, 'broadcastStatus');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "Filters (specify exactly one of the following parameters)"
  if ([ids.length > 0, mine, byStatus !== undefined].filter(Boolean).length !== 1) return refuse(ctx, 400, 'youtube.parameter', 'incompatibleParameters', 'The request specifies two or more parameters that cannot be used in the same request.');
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The request failed because it contained an invalid parameter or parameter value."
  if (byStatus !== undefined && !(byStatus in BY_STATUS)) return refuse(ctx, 400, 'youtube.parameter', 'invalidParameter', 'The request failed because it contained an invalid parameter or parameter value.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "Acceptable values are 0 to 50 , inclusive. The default value is 5 ."
  const size = maxResultsOf(ctx, 5, 0, 50);
  if (size instanceof Response) return size;
  const offset = offsetFor(ctx);
  if (offset instanceof Response) return offset;
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "The default value is event ."
  const type = query(ctx, 'broadcastType') ?? 'event';
  let rows: Row[];
  if (ids.length) rows = ids.map((id) => live(ctx.row(BROADCAST, id))).filter((b): b is Row => !!b && (b._sub === who.caller.sub || obj(ctx.own(b).status).privacyStatus !== 'private'));
  else {
    const statuses = byStatus ? BY_STATUS[byStatus] : undefined;
    // the World makes no persistent (default) broadcast: every broadcast is an event
    rows = type === 'persistent' ? [] : ctx.rowsRaw(BROADCAST).filter((b) => b.deleted !== true && b._sub === who.caller.sub && (!statuses || statuses.includes(String(obj(ctx.own(b).status).lifeCycleStatus))));
  }
  return listAnswer(ctx, 'youtube#liveBroadcastListResponse', rows.map((b) => answerOf(ctx, b, parts)), offset, size);
}

// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind "Binds a YouTube broadcast to a stream or removes an existing binding between a broadcast and a stream."
export async function youtube_liveBroadcasts_bind(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const id = query(ctx, 'id');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind "The required id parameter must identify the broadcast to bind."
  if (!id) return refuse(ctx, 400, DOMAIN, 'idRequired', 'The required id parameter must identify the broadcast to bind.');
  const broadcast = ownBroadcast(ctx, who.caller.sub, id);
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind "The broadcast specified by the id parameter does not exist."
  if (!broadcast) return refuse(ctx, 404, DOMAIN, 'liveBroadcastNotFound', NOT_FOUND);
  const streamId = query(ctx, 'streamId');
  const stream = streamId ? live(ctx.row(STREAM, streamId)) : undefined;
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind "The stream specified by the streamId parameter does not exist."
  if (streamId && (!stream || stream._sub !== who.caller.sub)) return refuse(ctx, 404, 'youtube.liveStream', 'liveStreamNotFound', 'The stream specified by the streamId parameter does not exist.');
  const b = ctx.own(broadcast);
  const current = String(obj(b.status).lifeCycleStatus);
  const to = streamId ? 'ready' : 'created';
  const refused = ctx.legal(BROADCAST, 'status.lifeCycleStatus', 'youtube.liveBroadcasts.bind', current, to, id);
  if (refused) return refuse(ctx, refused.status, DOMAIN, String(refused.code), refused.message);
  const details = { ...obj(b.contentDetails) };
  if (streamId) { details.boundStreamId = streamId; details.boundStreamLastUpdateTimeMs = ctx.occurredAt; }
  else { delete details.boundStreamId; delete details.boundStreamLastUpdateTimeMs; }
  await ctx.write(BROADCAST, id, { contentDetails: details, status: { ...obj(b.status), lifeCycleStatus: to } }, 'youtube.liveBroadcasts.bind');
  return Response.json(answerOf(ctx, ctx.row(BROADCAST, id)!, parts));
}

// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "Changes the status of a YouTube live broadcast and initiates any processes associated with the new status."
export async function youtube_liveBroadcasts_transition(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const id = query(ctx, 'id');
  const wanted = query(ctx, 'broadcastStatus');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "The required id parameter must identify the broadcast whose status you want to transition."
  if (!id) return refuse(ctx, 400, DOMAIN, 'idRequired', 'The required id parameter must identify the broadcast whose status you want to transition.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "The API request must specify a value for the status parameter."
  if (!wanted) return refuse(ctx, 400, DOMAIN, 'statusRequired', 'The API request must specify a value for the status parameter.');
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The request failed because it contained an invalid parameter or parameter value."
  if (!['testing', 'live', 'complete'].includes(wanted)) return refuse(ctx, 400, 'youtube.parameter', 'invalidParameter', 'The request failed because it contained an invalid parameter or parameter value.');
  const broadcast = ownBroadcast(ctx, who.caller.sub, id);
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "The broadcast specified by the id parameter does not exist."
  if (!broadcast) return refuse(ctx, 404, DOMAIN, 'liveBroadcastNotFound', NOT_FOUND);
  const b = ctx.own(broadcast);
  const current = String(obj(b.status).lifeCycleStatus);
  const details = obj(b.contentDetails);
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "The live broadcast is already in the requested status or processing to the requested status."
  if (current === wanted || current === `${wanted}Starting` || (wanted === 'testing' && current === 'testStarting')) return refuse(ctx, 403, DOMAIN, 'redundantTransition', 'The live broadcast is already in the requested status or processing to the requested status.');
  const invalid = (): Response => refuse(ctx, 403, DOMAIN, 'invalidTransition', "The live broadcast can't transition from its current status to the requested status.");
  const monitored = obj(details.monitorStream).enableMonitorStream !== false;
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "Note that you can only transition a broadcast to the testing state if its contentDetails.monitorStream.enableMonitorStream property is set to true ."
  if (wanted === 'testing' && !monitored) return invalid();
  // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "then you must transition your broadcast to the testing state before you can transition it to the live state."
  if (wanted === 'live' && monitored && current === 'ready') return invalid();
  const to = wanted === 'testing' ? 'testStarting' : wanted === 'live' ? 'liveStarting' : 'complete';
  const refused = ctx.legal(BROADCAST, 'status.lifeCycleStatus', 'youtube.liveBroadcasts.transition', current, to, id);
  if (refused) return refuse(ctx, refused.status, DOMAIN, String(refused.code), refused.message);
  if (wanted !== 'complete') {
    const stream = typeof details.boundStreamId === 'string' ? live(ctx.row(STREAM, details.boundStreamId)) : undefined;
    // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "The requested transition is not allowed when the stream that is bound to the broadcast is inactive."
    if (!stream || obj(ctx.own(stream).status).streamStatus !== 'active') return refuse(ctx, 403, DOMAIN, 'errorStreamInactive', 'The requested transition is not allowed when the stream that is bound to the broadcast is inactive.');
  }
  await moveBroadcast(ctx, broadcast, to, 'youtube.liveBroadcasts.transition');
  const answer = answerOf(ctx, ctx.row(BROADCAST, id)!, parts);
  // YouTube finishes the move it started
  await settleBroadcast(ctx, id, 'youtube.liveBroadcasts.transition');
  if (to === 'complete') {
    // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages "The chat has ended and no more messages can be inserted after this one. This will occur naturally a little while after a broadcast ends."
    const liveChatId = String(obj(b.snippet).liveChatId);
    const message = ctx.mint(CHAT_MESSAGE);
    await ctx.asVendor(() => ctx.write(CHAT_MESSAGE, message, { kind: 'youtube#liveChatMessage', id: message, snippet: { type: 'chatEndedEvent', liveChatId, publishedAt: ctx.occurredAt, hasDisplayContent: false }, _liveChat: liveChatId }, 'youtube.liveBroadcasts.transition'));
  }
  return Response.json(answer);
}
