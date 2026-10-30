// The Streams family: Get Streams (whether a channel is live, with its viewers, title and category: the channel page, the
// stream manager, the setup script) and Get Stream Key (the creator dashboard's Stream settings).
import type { HandlerContext } from '@volter/world-core';
import { callerOf, dataAnswer, pageOf, queryValues, streamKeyOf, streamView, twitchError, userByLogin, userTokenRefusal } from './shared.ts';

export async function getStreams(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const type = url.searchParams.get('type') ?? 'all';
  // source: spec:/paths/~1streams/get/parameters/3/description "Possible values are: all live The default is all."
  // source: spec:/paths/~1streams/get/responses/400/description "The value in the type query parameter is not valid."
  if (type !== 'all' && type !== 'live') return twitchError(400, 'The value in the type query parameter is not valid.');
  const userIds = new Set([...queryValues(ctx, 'user_id'), ...queryValues(ctx, 'user_login').map((l) => String(userByLogin(ctx, l)?.id ?? ''))]);
  const filtered = queryValues(ctx, 'user_id').length + queryValues(ctx, 'user_login').length > 0;
  const games = queryValues(ctx, 'game_id');
  const languages = queryValues(ctx, 'language');
  // source: spec:/paths/~1streams/get/parameters/1/description "Returns only the streams of those users that are broadcasting."
  const streams = ctx.rowsRaw('stream').filter((s) => s.deleted !== true)
    .filter((s) => !filtered || userIds.has(String(s.user_id)))
    .filter((s) => !games.length || games.includes(String(s.game_id)))
    .filter((s) => !languages.length || languages.includes(String(s.language)))
    // source: spec:getStreams "The list is in descending order by the number of viewers watching the stream."
    .sort((a, b) => Number(b.viewer_count) - Number(a.viewer_count));
  return pageOf(ctx, streams.map(streamView));
}

export async function getStreamKey(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  // source: spec:getStreamKey "Requires a user access token that includes the channel:read:stream_key scope."
  const refused = userTokenRefusal(caller, 'channel:read:stream_key', {
    // source: spec:/paths/~1streams~1key/get/responses/401/description "The Authorization header is required and must contain a user access token."
    user: 'The Authorization header is required and must contain a user access token.',
    // source: spec:/paths/~1streams~1key/get/responses/401/description "The user access token must include the channel:read:stream_key scope."
    scope: 'The user access token must include the channel:read:stream_key scope.',
  });
  if (refused) return refused;
  const id = queryValues(ctx, 'broadcaster_id')[0];
  // source: spec:/paths/~1streams~1key/get/responses/400/description "The broadcaster_id field is required."
  if (!id) return twitchError(400, 'The broadcaster_id field is required.');
  // source: spec:/paths/~1streams~1key/get/responses/401/description "The ID in broadcaster_id must match the user ID in the access token."
  if (id !== caller.userId) return twitchError(401, 'The ID in broadcaster_id must match the user ID in the access token.');
  return dataAnswer([{ stream_key: await streamKeyOf(ctx, id) }]);
}
