// The Channels family: Get Channel Information (the channel page, the stream manager, the setup script's read) and
// Modify Channel Information (the stream manager's Edit Stream Info: its title and category).
import type { HandlerContext } from '@volter/world-core';
import { callerOf, categoryById, channelOf, channelView, dataAnswer, liveStreamOf, queryValues, twitchError, userTokenRefusal, type Row } from './shared.ts';

export async function getChannelInformation(ctx: HandlerContext): Promise<Response> {
  const ids = queryValues(ctx, 'broadcaster_id');
  // source: spec:/paths/~1channels/get/responses/400/description "The broadcaster_id query parameter is required."
  if (!ids.length) return twitchError(400, 'The broadcaster_id query parameter is required.');
  // source: spec:/paths/~1channels/get/parameters/0/description "The API ignores duplicate IDs and IDs that are not found."
  const channels = [...new Set(ids)].map((id) => channelOf(ctx, id)).filter((c): c is Row => c !== undefined);
  return dataAnswer(channels.map(channelView));
}

/** The labels a channel may declare (Get Content Classification Labels' ids). Where the documentation stops: the
 *  reference names these in Modify Channel Information's body; the twin knows those. */
// source: spec:/components/schemas/ModifyChannelInformationBody/properties/content_classification_labels/items/properties/id/description "DebatedSocialIssuesAndPolitics"
const LABELS = ['DebatedSocialIssuesAndPolitics', 'DrugsIntoxication', 'SexualThemes', 'ViolentGraphic', 'Gambling', 'ProfanityVulgarity'];

export async function modifyChannelInformation(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  // source: spec:modifyChannelInformation "Requires a user access token that includes the channel:manage:broadcast scope."
  const refused = userTokenRefusal(caller, 'channel:manage:broadcast', {
    // source: spec:/paths/~1channels/patch/responses/401/description "The Authorization header is required and must specify a user access token."
    user: 'The Authorization header is required and must specify a user access token.',
    // source: spec:/paths/~1channels/patch/responses/401/description "The OAuth token must include the channel:manage:broadcast scope."
    scope: 'The OAuth token must include the channel:manage:broadcast scope.',
  });
  if (refused) return refused;
  const id = queryValues(ctx, 'broadcaster_id')[0];
  // source: spec:/paths/~1channels/patch/responses/400/description "The broadcaster_id query parameter is required."
  if (!id) return twitchError(400, 'The broadcaster_id query parameter is required.');
  // source: spec:/paths/~1channels/patch/responses/401/description "The ID in broadcaster_id must match the user ID found in the OAuth token."
  if (id !== caller.userId) return twitchError(401, 'The ID in broadcaster_id must match the user ID found in the OAuth token.');
  const channel = channelOf(ctx, id)!;
  const body = (ctx.body ?? {}) as Row;
  const changes: Row = {};
  if ('title' in body) {
    // source: spec:/paths/~1channels/patch/responses/400/description "The title field may not contain an empty string."
    if (typeof body.title !== 'string' || body.title.trim() === '') return twitchError(400, 'The title field may not contain an empty string.');
    changes.title = body.title;
  }
  if ('game_id' in body) {
    const game = String(body.game_id ?? '');
    // source: spec:/components/schemas/ModifyChannelInformationBody/properties/game_id/description "To unset this field, use"
    if (game === '' || game === '0') Object.assign(changes, { game_id: '', game_name: '' });
    else {
      const category = categoryById(game);
      // source: spec:/paths/~1channels/patch/responses/400/description "The ID in game_id is not valid."
      if (!category) return twitchError(400, 'The ID in game_id is not valid.');
      Object.assign(changes, { game_id: category.id, game_name: category.name });
    }
  }
  if ('broadcaster_language' in body && typeof body.broadcaster_language === 'string') {
    // source: spec:/components/schemas/ModifyChannelInformationBody/properties/broadcaster_language/description "Set the value to an ISO 639-1 two-letter language code"
    // the language is not updated when it is not one (the same description: "The language isn't updated")
    if (/^[a-z]{2}$|^other$/.test(body.broadcaster_language)) changes.broadcaster_language = body.broadcaster_language;
  }
  if ('delay' in body) {
    // source: spec:/paths/~1channels/patch/responses/400/description "To update the delay field, the broadcaster must have partner status."
    if (channel.broadcaster_type !== 'partner') return twitchError(400, 'To update the delay field, the broadcaster must have partner status.');
  }
  if ('tags' in body && Array.isArray(body.tags)) {
    const tags = body.tags.map(String);
    // source: spec:/components/schemas/ModifyChannelInformationBody/properties/tags/description "A channel may specify a maximum of 10 tags."
    // source: spec:/paths/~1channels/patch/responses/400/description "The list in the tags field exceeds the maximum number of tags allowed."
    if (tags.length > 10) return twitchError(400, 'The list in the tags field exceeds the maximum number of tags allowed.');
    // source: spec:/components/schemas/ModifyChannelInformationBody/properties/tags/description "Each tag is limited to a maximum of 25 characters"
    // source: spec:/paths/~1channels/patch/responses/400/description "A tag in the tags field exceeds the maximum length allowed."
    if (tags.some((t) => t.length > 25)) return twitchError(400, 'A tag in the tags field exceeds the maximum length allowed.');
    changes.tags = tags;
  }
  if ('content_classification_labels' in body && Array.isArray(body.content_classification_labels)) {
    const labels = new Set((channel.content_classification_labels as string[] | undefined) ?? []);
    for (const label of body.content_classification_labels as Row[]) {
      if (!LABELS.includes(String(label.id))) continue;
      if (label.is_enabled === true) labels.add(String(label.id)); else labels.delete(String(label.id));
    }
    changes.content_classification_labels = [...labels];
  }
  if ('is_branded_content' in body && typeof body.is_branded_content === 'boolean') changes.is_branded_content = body.is_branded_content;
  // source: spec:/paths/~1channels/patch/responses/400/description "The request must update at least one property."
  if (!Object.keys(changes).length) return twitchError(400, 'The request must update at least one property.');
  await ctx.write('GetChannelInformationResponseData', id, changes, 'modifyChannelInformation');
  const stream = liveStreamOf(ctx, id);
  if (stream) await showOnLiveStream(ctx, stream, changes);
  // source: spec:/paths/~1channels/patch/responses/204/description "Successfully updated the channel"
  return new Response(null, { status: 204 });
}

/** A live stream shows the channel's title, category and tags as they now are (Get Streams' title: "The stream's title"). */
async function showOnLiveStream(ctx: HandlerContext, stream: Row, changes: Row): Promise<void> {
  const shown = Object.fromEntries(Object.entries(changes).filter(([k]) => ['title', 'game_id', 'game_name', 'tags'].includes(k)));
  if (Object.keys(shown).length) await ctx.write('GetStreamsResponseData', String(stream.id), shown, 'modifyChannelInformation');
}
