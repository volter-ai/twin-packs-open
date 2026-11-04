// YouTube's ingest (the manifest's live `ingest`, world-core's live media): what an encoder publishes to
// <ingestionAddress>/<streamName>. The kernel holds the RTMP wire and the recording; this dialect says what YouTube does
// with them: a stream name names its liveStream, which is active from the publish's first segment until the encoder
// stops, and a broadcast bound to it that starts and stops with its stream (enableAutoStart, enableAutoStop) goes live
// and completes with it.
//
// Where the documentation stops: YouTube documents no words for a stream name it does not know; the twin refuses the
// publish with RTMP's bad-name status. A stream takes one encoder at a time: a second publisher is the kernel's refusal.
import type { HandlerContext, LiveEngine } from '@volter/world-core';
import { BROADCAST, STREAM, broadcastsBoundTo, live, moveBroadcast, obj, type Row } from './shared.ts';

/** The stream an encoder's stream name names. */
function streamOfName(ctx: HandlerContext, name: string): Row | undefined {
  return name ? ctx.rowsRaw(STREAM).find((s) => s.deleted !== true && obj(obj(ctx.own(s).cdn).ingestionInfo).streamName === name) : undefined;
}

/** A stream's move to `to`, an encoder's act (`external`), with its health. */
async function moveStream(ctx: HandlerContext, stream: Row, to: 'active' | 'inactive', operation: string): Promise<void> {
  const s = ctx.own(stream);
  const from = String(obj(s.status).streamStatus);
  if (from === to) return;
  const refused = ctx.legal(STREAM, 'status.streamStatus', operation, from, to, String(s.id), 'external');
  if (refused) return;
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "There are no configuration issues for which the severity is warning or worse."
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "The last time that the stream's health status was updated. The value reflects a UNIX timestamp in seconds."
  const health = to === 'active' ? { status: 'good', lastUpdateTimeSeconds: String(Math.floor(Date.parse(ctx.occurredAt) / 1000)), configurationIssues: [] } : { status: 'noData' };
  await ctx.write(STREAM, String(s.id), { status: { streamStatus: to, healthStatus: health } }, operation);
}

export const ingest: LiveEngine<HandlerContext> = {
  publish(ctx, ask) {
    // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "The stream name that YouTube assigns to the video stream."
    const stream = streamOfName(ctx, ask.key);
    if (!stream) return { refused: 'NetStream.Publish.BadName', description: 'Invalid stream name' };
    return { stream: String(ctx.own(stream).id) };
  },
  async started(ctx, recording) {
    const stream = live(ctx.row(STREAM, recording.stream));
    if (!stream) return;
    await moveStream(ctx, stream, 'active', 'live:ingest');
    // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "Indicates whether this broadcast should start automatically when you start streaming video on the bound live stream ."
    for (const b of broadcastsBoundTo(ctx, recording.stream)) {
      const v = ctx.own(b);
      const from = String(obj(v.status).lifeCycleStatus);
      if (obj(v.contentDetails).enableAutoStart !== true || !['ready', 'testing'].includes(from)) continue;
      if (ctx.legal(BROADCAST, 'status.lifeCycleStatus', 'live:ingest', from, 'live', String(v.id), 'vendor')) continue;
      await moveBroadcast(ctx, b, 'live', 'live:ingest');
    }
  },
  async ended(ctx, recording) {
    const stream = live(ctx.row(STREAM, recording.stream));
    if (!stream) return;
    await moveStream(ctx, stream, 'inactive', 'live:ingest');
    // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "Indicates whether this broadcast should stop automatically around one minute after the channel"
    // Where the documentation stops: the twin completes such a broadcast when its encoder stops, without the minute.
    for (const b of broadcastsBoundTo(ctx, recording.stream)) {
      const v = ctx.own(b);
      if (obj(v.contentDetails).enableAutoStop !== true || obj(v.status).lifeCycleStatus !== 'live') continue;
      if (ctx.legal(BROADCAST, 'status.lifeCycleStatus', 'live:ingest', 'live', 'complete', String(v.id), 'vendor')) continue;
      await moveBroadcast(ctx, b, 'complete', 'live:ingest');
    }
  },
};
