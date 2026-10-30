// The Chat family: Send Chat Message, as the simulated viewers post as each viewer and as a person chats from the
// channel page, its popout or the stream manager. The message is kept (`chat_message`), and every chat session that
// joined the channel hears it (./sockets.ts), as the channel's pages show it.
import type { HandlerContext } from '@volter/world-core';
import { callerOf, CHAT_MESSAGE_LIMIT, chatOf, dataAnswer, twitchError, userById, userTokenRefusal, type Row } from './shared.ts';

/** How long a message sent with `pin` stays pinned. */
// source: spec:/components/schemas/SendChatMessageBody/properties/pin/description "Messages pinned via this endpoint are always pinned for 20 minutes."
const PIN_MS = 20 * 60 * 1000;

export async function sendChatMessage(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  // Where the twin stops: an app access token sends chat only after the sender authorized the app with user:bot and the
  // channel with channel:bot (the operation's Authorization); no demanded caller sends so, and that path is the gap.
  if (caller.kind === 'app') return ctx.gap();
  // source: spec:sendChatMessage "A user access token that includes the user:write:chat scope."
  const refused = userTokenRefusal(caller, 'user:write:chat', {
    // source: spec:/paths/~1chat~1messages/post/responses/401/description "The Authorization header is required and must contain a user access token."
    user: 'The Authorization header is required and must contain a user access token.',
    // source: spec:/paths/~1chat~1messages/post/responses/401/description "The user access token must include the user:write:chat scope."
    scope: 'The user access token must include the user:write:chat scope.',
  });
  if (refused) return refused;
  const body = (ctx.body ?? {}) as Row;
  const broadcasterId = typeof body.broadcaster_id === 'string' ? body.broadcaster_id : '';
  const senderId = typeof body.sender_id === 'string' ? body.sender_id : '';
  // source: spec:/paths/~1chat~1messages/post/responses/400/description "The broadcaster_id query parameter is required."
  if (!broadcasterId) return twitchError(400, 'The broadcaster_id query parameter is required.');
  // source: spec:/paths/~1chat~1messages/post/responses/400/description "The sender_id query parameter is required."
  if (!senderId) return twitchError(400, 'The sender_id query parameter is required.');
  // source: spec:/paths/~1chat~1messages/post/responses/400/description "The text query parameter is required."
  if (typeof body.message !== 'string' || body.message === '') return twitchError(400, 'The text query parameter is required.');
  const broadcaster = userById(ctx, broadcasterId);
  // source: spec:/paths/~1chat~1messages/post/responses/400/description "The ID in the broadcaster_id query parameter is not valid."
  if (!broadcaster) return twitchError(400, 'The ID in the broadcaster_id query parameter is not valid.');
  // source: spec:/components/schemas/SendChatMessageBody/properties/sender_id/description "This ID must match the user ID in the user access token."
  // source: spec:/paths/~1chat~1messages/post/responses/401/description "The ID in the user_id query parameter must match the user ID in the access token."
  if (senderId !== caller.userId) return twitchError(401, 'The ID in the user_id query parameter must match the user ID in the access token.');
  // source: spec:/components/schemas/SendChatMessageBody/properties/for_source_only/description "It cannot be specified when a User Access Token is used, and will instead result in an HTTP 400 error."
  if ('for_source_only' in body) return twitchError(400, 'Cannot set for_source_only if User Access Token is used.');
  const pin = body.pin === true;
  if (pin) {
    // source: spec:/components/schemas/SendChatMessageBody/properties/pin/description "Cannot be combined with"
    // source: spec:/paths/~1chat~1messages/post/responses/400/description "parameter is not supported when"
    if (typeof body.reply_parent_message_id === 'string') return twitchError(400, 'The reply_parent_message_id parameter is not supported when pin is true.');
    // source: spec:/paths/~1chat~1messages/post/responses/401/description "Pinning requires the moderator:manage:chat_messages scope."
    if (!caller.firstParty && !caller.scopes.includes('moderator:manage:chat_messages')) return twitchError(401, 'Pinning requires the moderator:manage:chat_messages scope.');
    // source: spec:/components/schemas/SendChatMessageBody/properties/pin/description "the sender must be the broadcaster or a moderator"
    // source: spec:/paths/~1chat~1messages/post/responses/403/description "The sender is not permitted to send chat messages to the broadcaster"
    if (senderId !== broadcasterId) return twitchError(403, 'The sender is not permitted to send chat messages to the broadcaster’s chat room.');
  }
  const history = chatOf(ctx, broadcasterId);
  let parent: Row | undefined;
  if (typeof body.reply_parent_message_id === 'string') {
    parent = history.find((m) => m.id === body.reply_parent_message_id);
    // source: spec:/paths/~1chat~1messages/post/responses/400/description "The ID in the reply_parent_message_id query parameter is not valid."
    if (!parent) return twitchError(400, 'The ID in the reply_parent_message_id query parameter is not valid.');
  }
  // source: spec:/paths/~1chat~1messages/post/responses/422/description "The message is too large."
  if ([...body.message].length > CHAT_MESSAGE_LIMIT) return twitchError(422, 'The message is too large.');
  const sender = userById(ctx, senderId)!;
  const at = Date.parse(ctx.occurredAt);
  const message = await ctx.create('chat_message', {
    broadcaster_id: broadcasterId, broadcaster_login: broadcaster.login,
    sender_id: senderId, sender_login: sender.login, sender_name: sender.display_name, color: sender.chat_color ?? '',
    // source: https://dev.twitch.tv/docs/chat/irc/ "broadcaster"
    badges: senderId === broadcasterId ? 'broadcaster/1' : '',
    first_msg: !history.some((m) => m.sender_id === senderId),
    message: body.message,
    ...(parent ? { reply_parent_message_id: parent.id, reply_parent_user_id: parent.sender_id, reply_parent_user_login: parent.sender_login, reply_parent_display_name: parent.sender_name, reply_parent_msg_body: parent.message } : {}),
    ...(pin ? { pinned_until: new Date(at + PIN_MS).toISOString() } : {}),
    sent_at: ctx.occurredAt, sent_at_ms: at,
  }, 'sendChatMessage');
  // source: spec:/components/schemas/SendChatMessageResponseData/properties/is_sent/description "If the message passed all checks and was sent."
  return dataAnswer([{ message_id: message.id, is_sent: true }]);
}
