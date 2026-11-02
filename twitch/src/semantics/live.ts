// Twitch's ingest (the manifest's live `ingest`, world-core's live media): what a broadcaster's encoder publishes to
// rtmp://<ingest-server>/app/<stream-key>, as OBS on the stream rig publishes it. The kernel holds the RTMP wire and the
// recording; this dialect says what Twitch does with them: a stream key names its channel, and the channel is live from
// the broadcast's first playable segment until the encoder stops. A bandwidth test is taken and recorded, and no one
// sees it: the channel stays offline.
//
// Where the documentation stops: Twitch documents no words for a stream key it does not know; the twin refuses the
// publish with RTMP's bad-name status and says the key is invalid. A channel takes one encoder at a time: a second
// publisher to the live stream is the kernel's refusal.
import type { HandlerContext, LiveEngine, LiveRecording } from '@volter/world-core';
import { channelOf, digestOf, liveStreamOf, STREAM_KEY, userById, type Row } from './shared.ts';

/** The name a bandwidth test's recording is kept under: its channel's id and the test's start. */
const TEST = /^bandwidthtest-(\d+)-/;

/** The channel a stream key names, by its SHA-256 (the account's sign-up recorded it). */
function channelOfKey(ctx: HandlerContext, key: string): Row | undefined {
  const held = key ? ctx.row(STREAM_KEY, digestOf(ctx, key)) : undefined;
  return held ? userById(ctx, String(held.user_id)) : undefined;
}

export const ingest: LiveEngine<HandlerContext> = {
  async publish(ctx, ask) {
    // source: https://dev.twitch.tv/docs/video-broadcast/ "uniquely identifies this stream. Stream keys are assigned by Twitch."
    const user = channelOfKey(ctx, ask.key);
    if (!user) return { refused: 'NetStream.Publish.BadName', description: 'Invalid stream key' };
    // source: https://dev.twitch.tv/docs/video-broadcast/ "is an optional query-string parameter that disables live viewing of the stream."
    if (ask.query.bandwidthtest === 'true') return { stream: `bandwidthtest-${String(user.id)}-${Date.parse(ctx.occurredAt)}` };
    // Reserve one broadcast per channel before playable media exists. Allocation and channel uniqueness share
    // the kernel's action lock; the hidden subject is not a live Helix stream until started writes its fields.
    const { row } = await ctx.createUnique('GetStreamsResponseData', { user_id: user.id }, 'live:reserve');
    return { stream: String(row.id) };
  },
  async started(ctx, recording) {
    if (TEST.test(recording.stream)) return;
    const user = channelOfKey(ctx, recording.key);
    if (!user || liveStreamOf(ctx, String(user.id))) return;
    const channel = channelOf(ctx, String(user.id)) ?? {};
    // source: spec:getStreams "Gets a list of all streams."
    await ctx.write('GetStreamsResponseData', recording.stream, {
      id: recording.stream, user_id: user.id, user_login: user.login, user_name: user.display_name,
      game_id: channel.game_id ?? '', game_name: channel.game_name ?? '',
      // source: spec:/components/schemas/GetStreamsResponseData/properties/type/description "Possible values are: live"
      type: 'live', title: channel.title ?? '', tags: channel.tags ?? [], viewer_count: 0,
      // source: spec:/components/schemas/GetStreamsResponseData/properties/started_at/description "The UTC date and time (in RFC3339 format) of when the broadcast began."
      started_at: recording.startedAt.replace(/\.\d{3}Z$/, 'Z'),
      language: channel.broadcaster_language ?? 'en',
      // source: https://dev.twitch.tv/docs/api/reference/ "https://static-cdn.jtvnw.net/previews-ttv/live_user_afro-{width}x{height}.jpg"
      thumbnail_url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${String(user.login)}-{width}x{height}.jpg`,
      tag_ids: [], is_mature: false,
    }, 'live:ingest');
  },
  async ended(ctx, recording: LiveRecording) {
    if (TEST.test(recording.stream)) return;
    // Internal exact-id cleanup must see a reservation that never became readable. The admitted recording owns
    // this subject even if its stream key was changed after admission.
    const held = ctx.row('stream', recording.stream);
    // the channel is offline: Get Streams answers only the streams of those users that are broadcasting
    // source: spec:/paths/~1streams/get/parameters/1/description "Returns only the streams of those users that are broadcasting."
    if (held) await ctx.remove('GetStreamsResponseData', recording.stream, 'live:ingest');
  },
};
