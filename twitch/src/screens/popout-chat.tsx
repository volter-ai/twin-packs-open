// A channel's chat on its own (a workspace): www.twitch.tv/popout/<login>/chat, as the chat panel's Popout Chat opens it.
//
//   GET  /popout/<login>/chat   "Stream Chat": the channel's messages (a LiveRegion: they land as they are sent) and, for
//                               a person logged in, the box to send one
//   GET  /popout/<login>/chat?live=chat&after=<last message id>   the messages' held read (world-ui's liveFragment)
//   POST /popout/<login>/chat   "Chat": Send Chat Message as the person logged in, then back to the popout
import type { HandlerContext } from '@volter/world-core';
import { sendChatMessage } from '../semantics/chat.ts';
import { getUsers } from '../semantics/users.ts';
import { answered, asOperation, ChatPanel, chatFragment, firstOf, linkTo, notFoundPage, personOn, postChat, shownError, twitchPage, type Row } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const login = String((ctx.call.params as Row).login ?? '').toLowerCase();
  const person = personOn(ctx);
  const user = firstOf((await answered(getUsers(asOperation(ctx, 'getUsers', person, { query: { login } })))).body);
  if (!user) return notFoundPage(ctx, person);
  const chat = chatFragment(ctx, user);
  if (chat) return chat;
  const here = linkTo('www.twitch.tv', `/popout/${String(user.login)}/chat?popout=`, ctx);
  if (ctx.call.request.method === 'POST') return postChat(ctx, user, person, here, sendChatMessage);
  const error = shownError(ctx, 'chat_error');
  return twitchPage(ctx, {
    title: `${String(user.display_name)} - Chat`, bare: true, ...(person ? { person } : {}),
    body: <ChatPanel ctx={ctx} broadcaster={user} action={here} popout {...(person ? { person } : {})} {...(error ? { error } : {})} />,
  });
}
