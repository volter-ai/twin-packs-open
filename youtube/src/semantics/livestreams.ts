// The liveStreams family: the video stream an encoder sends to YouTube (liveStreams.insert), with the ingestion
// address and the stream name it publishes to, and the channel's streams read back (liveStreams.list).
import type { HandlerContext } from '@volter/world-core';
import { STREAM, answerOf, bodyObject, callerChannel, idOf, listAnswer, listParam, live, maxResultsOf, obj, offsetFor, partsOf, query, refuse, type Row } from './shared.ts';

const RESOLUTIONS = ['240p', '360p', '480p', '720p', '1080p', '1440p', '2160p', 'variable'];
const FRAME_RATES = ['30fps', '60fps', 'variable'];
const INGESTION = ['rtmp', 'dash', 'hls'];

/** A stream name of YouTube's form (four groups of four and a fifth, as its encoder settings show it), drawn from a
 *  secret the World holds, so no one computes it from the stream's id. */
async function streamNameFor(ctx: HandlerContext, id: string): Promise<string> {
  const raw = (await ctx.secret(`youtube:stream-name:${id}`)).replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(20, '0');
  return [0, 4, 8, 12, 16].map((i) => raw.slice(i, i + 4)).join('-');
}

// source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "Creates a video stream. The stream enables you to send your video to YouTube, which can then broadcast the video to your audience."
export async function youtube_liveStreams_insert(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const body = bodyObject(ctx);
  const snippet = obj(body.snippet);
  const cdn = body.cdn === undefined ? undefined : obj(body.cdn);
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The liveStream resource must specify a value for the snippet.title property."
  if (typeof snippet.title !== 'string' || !snippet.title) return refuse(ctx, 400, 'youtube.liveStream', 'titleRequired', 'The liveStream resource must specify a value for the snippet.title property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "must be between 1 and 128 characters long."
  if ([...snippet.title].length > 128) return refuse(ctx, 400, 'youtube.liveStream', 'invalidTitle', "The snippet.title property's value in the liveStream resource must be between 1 and 128 characters long.");
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The snippet.description property's value in the liveStream resource can have up to 10000 characters."
  if (snippet.description !== undefined && [...String(snippet.description)].length > 10000) return refuse(ctx, 400, 'youtube.liveStream', 'invalidDescription', "The snippet.description property's value in the liveStream resource can have up to 10000 characters.");
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The liveStream resource must contain the cdn object."
  if (!cdn) return refuse(ctx, 400, 'youtube.liveStream', 'cdnRequired', 'The liveStream resource must contain the cdn object.');
  if (cdn.ingestionType === undefined) return refuse(ctx, 400, 'youtube.liveStream', 'ingestionTypeRequired', 'The liveStream resource must specify a value for the cdn.ingestionType property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The cdn.ingestionType property's value in the liveStream resource is invalid."
  if (!INGESTION.includes(String(cdn.ingestionType))) return refuse(ctx, 400, 'youtube.liveStream', 'invalidIngestionType', "The cdn.ingestionType property's value in the liveStream resource is invalid.");
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The API returns this error if you specify a value for the cdn.resolution property but not for the cdn.frameRate property."
  if (cdn.resolution !== undefined && cdn.frameRate === undefined) return refuse(ctx, 400, 'youtube.liveStream', 'frameRateRequired', 'The API returns this error if you specify a value for the cdn.resolution property but not for the cdn.frameRate property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The API returns this error if you specify a value for the cdn.frameRate property but not for the cdn.resolution property."
  if (cdn.frameRate !== undefined && cdn.resolution === undefined) return refuse(ctx, 400, 'youtube.liveStream', 'resolutionRequired', 'The API returns this error if you specify a value for the cdn.frameRate property but not for the cdn.resolution property.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "You must also set cdn.frameRate to variable ."
  if (cdn.resolution !== undefined && (!RESOLUTIONS.includes(String(cdn.resolution)) || (cdn.resolution === 'variable') !== (cdn.frameRate === 'variable'))) return refuse(ctx, 400, 'youtube.liveStream', 'invalidResolution', "The cdn.resolution property's value in the liveStream resource is invalid.");
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/insert "The cdn.frameRate property's value in the liveStream resource is invalid."
  if (cdn.frameRate !== undefined && !FRAME_RATES.includes(String(cdn.frameRate))) return refuse(ctx, 400, 'youtube.liveStream', 'invalidFrameRate', "The cdn.frameRate property's value in the liveStream resource is invalid.");
  const id = ctx.mint(STREAM);
  const name = await streamNameFor(ctx, id);
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "The stream name that YouTube assigns to the video stream."
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "The primary ingestion URL that you should use to stream video to YouTube if you use RTMP,"
  // Where the documentation stops: the pages name the address's property and not its value; the twin answers YouTube's
  // published RTMP ingest server, rtmp://a.rtmp.youtube.com/live2 (its backup b.rtmp), whose app is the manifest's live
  // app. In a World an encoder is given the World's ingest (the descriptor's side port named ingest,
  // rtmp://127.0.0.1:<port>/live2) in its place, with this stream name. DASH and HLS ingestion are the manifest's variants.
  const ingestionInfo = { streamName: name, ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', backupIngestionAddress: 'rtmp://b.rtmp.youtube.com/live2?backup=1' };
  const fields: Row = {
    kind: 'youtube#liveStream', id,
    snippet: { publishedAt: ctx.occurredAt, channelId: idOf(ctx, who.channel), title: snippet.title, description: typeof snippet.description === 'string' ? snippet.description : '', isDefaultStream: false },
    cdn: { ingestionType: cdn.ingestionType, ingestionInfo, resolution: cdn.resolution ?? 'variable', frameRate: cdn.frameRate ?? 'variable' },
    // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "The stream has valid CDN settings."
    // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "YouTube's live streaming backend servers do not have any information about the stream's health status."
    status: { streamStatus: 'ready', healthStatus: { status: 'noData' } },
    // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "Indicates whether the stream is reusable, which means that it can be bound to multiple broadcasts."
    // Where the documentation stops: the page gives no default for isReusable; the twin keeps true when none is given.
    contentDetails: { isReusable: obj(body.contentDetails).isReusable !== false },
    _channel: idOf(ctx, who.channel), _sub: who.caller.sub,
  };
  await ctx.write(STREAM, id, fields, 'youtube.liveStreams.insert');
  return Response.json(answerOf(ctx, ctx.row(STREAM, id)!, parts));
}

// source: https://developers.google.com/youtube/v3/live/docs/liveStreams/list "Returns a list of video streams that match the API request parameters."
export async function youtube_liveStreams_list(ctx: HandlerContext): Promise<Response> {
  const who = callerChannel(ctx);
  if (who instanceof Response) return who;
  const parts = partsOf(ctx);
  const ids = listParam(ctx, 'id');
  const mine = ctx.flag(query(ctx, 'mine')) === true;
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/list "Filters (specify exactly one of the following parameters)"
  if ((ids.length > 0) === mine) return refuse(ctx, 400, 'youtube.parameter', 'incompatibleParameters', 'The request specifies two or more parameters that cannot be used in the same request.');
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/list "Acceptable values are 0 to 50 , inclusive. The default value is 5 ."
  const size = maxResultsOf(ctx, 5, 0, 50);
  if (size instanceof Response) return size;
  const offset = offsetFor(ctx);
  if (offset instanceof Response) return offset;
  const own = (s: Row): boolean => s._sub === who.caller.sub;
  const rows = mine ? ctx.rowsRaw(STREAM).filter((s) => s.deleted !== true && own(s)) : ids.map((id) => live(ctx.row(STREAM, id))).filter((s): s is Row => !!s && own(s));
  return listAnswer(ctx, 'youtube#liveStreamListResponse', rows.map((s) => answerOf(ctx, s, parts)), offset, size);
}
