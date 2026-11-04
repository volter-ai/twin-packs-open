// Updating messages (https://core.telegram.org/bots/api#updating-messages) the demand reaches: a message deleted.
import type { HandlerContext } from '@volter/world-core';
import { answer, botOf, chatFor, intParam, param, refuse, unixOf } from './shared.ts';

// source: https://core.telegram.org/bots/api#deletemessage "Use this method to delete a message, including service messages, with the following limitations:"
export async function deleteMessage(ctx: HandlerContext): Promise<Response> {
  const { id: botId } = botOf(ctx);
  const access = chatFor(ctx, botId, param(ctx, 'chat_id'), 'write');
  if ('refusal' in access) return access.refusal;
  const { chat, member } = access;
  const messageId = intParam(ctx, 'message_id') ?? 0;
  const key = `${chat.id}:${messageId}`;
  const message = messageId > 0 ? ctx.row('message', key) : undefined;
  // a private chat's messages with another bot are not this bot's to see
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "message to delete"
  // (the server names the message type it looked for, followed by "not found")
  if (!message || message.deleted === true || (chat.type === 'private' && Number(message._with) !== botId)) return refuse(ctx, 400, 'Bad Request: message to delete not found');
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "message can't be deleted"
  const cannot = (): Response => refuse(ctx, 400, "Bad Request: message can't be deleted");
  // source: https://core.telegram.org/bots/api#deletemessage "A message can only be deleted if it was sent less than 48 hours ago."
  if (unixOf(ctx.occurredAt) - Number(message.date) >= 48 * 60 * 60) return cannot();
  // source: https://core.telegram.org/bots/api#deletemessage "Service messages about a supergroup, channel, or forum topic creation can't be deleted."
  if (message.channel_chat_created === true || message.supergroup_chat_created === true) return cannot();
  const outgoing = Number(message._sent_by) === botId;
  const status = String(member?.status ?? '');
  const admin = status === 'creator' || status === 'administrator';
  let allowed = false;
  // source: https://core.telegram.org/bots/api#deletemessage "Bots can delete outgoing messages in private chats, groups, and supergroups."
  if (outgoing && chat.type !== 'channel') allowed = true;
  // source: https://core.telegram.org/bots/api#deletemessage "Bots can delete incoming messages in private chats."
  if (chat.type === 'private') allowed = true;
  // source: https://core.telegram.org/bots/api#deletemessage "Bots granted can_post_messages permissions can delete outgoing messages in channels."
  if (outgoing && chat.type === 'channel' && (status === 'creator' || member?.can_post_messages === true)) allowed = true;
  // source: https://core.telegram.org/bots/api#deletemessage "If the bot is an administrator of a group, it can delete any message there."
  if (chat.type === 'group' && admin) allowed = true;
  // source: https://core.telegram.org/bots/api#deletemessage "If the bot has can_delete_messages administrator right in a supergroup or a channel, it can delete any message there."
  if ((chat.type === 'supergroup' || chat.type === 'channel') && (status === 'creator' || member?.can_delete_messages === true)) allowed = true;
  if (!allowed) return cannot();
  await ctx.remove('message', key, ctx.call.operation.id);
  return answer(true);
}
