// The creator dashboard's stream manager (a workspace): dashboard.twitch.tv/u/<login>/stream-manager, where the streamer
// sees the stream live or offline, edits what it is called and its category, and answers chat.
//
//   GET  /u/<login>/stream-manager                         the stream preview (world-ui's LivePlayer) with the live or
//                                                          offline status and the viewers; Edit Stream Info (the title,
//                                                          the category); My Chat
//   GET  /u/<login>/stream-manager?category_query=<words>  Edit Stream Info with the categories the words find
//   POST /u/<login>/stream-manager                         "Done" (intent=save: the title and the category chosen) or the
//                                                          chat box's "Chat" (intent=chat), then back to the manager, with
//                                                          Twitch's words for a refusal (`error`, `chat_error`)
//
// The page is the channel's own: a visitor is sent to log in, and another account is told the page is not there. What it
// shows and does are Twitch's API calls made as the streamer (Get Channel Information, Get Streams, Search Categories,
// Modify Channel Information, Send Chat Message). Where the documentation stops: the stream manager is twitch.tv's own
// client; its panels' names and controls here are Twitch's own labels, and Edit Stream Info's tags, language, rerun and
// branded-content controls are not drawn (no act of the demand sets them).
import type { HandlerContext } from '@volter/world-core';
import { getChannelInformation, modifyChannelInformation } from '../semantics/channels.ts';
import { sendChatMessage } from '../semantics/chat.ts';
import { searchCategories } from '../semantics/search.ts';
import { getStreams } from '../semantics/streams.ts';
import { answered, asOperation, backTo, ChatPanel, chatFragment, firstOf, formOf, linkTo, notFoundPage, personOn, Player, postChat, shownError, toLogIn, twitchPage, type Row } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const login = String((ctx.call.params as Row).login ?? '').toLowerCase();
  const person = personOn(ctx);
  if (!person) return toLogIn(ctx);
  if (person.login !== login) return notFoundPage(ctx, person);
  const chat = chatFragment(ctx, person);
  if (chat) return chat;
  const here = linkTo('dashboard.twitch.tv', `/u/${login}/stream-manager`, ctx);
  const form = ctx.call.request.method === 'POST' ? formOf(ctx) : undefined;
  if (form?.intent === 'save') {
    const body = { title: form.title ?? '', ...(form.game_id !== undefined ? { game_id: form.game_id } : {}) };
    const saved = await answered(modifyChannelInformation(asOperation(ctx, 'modifyChannelInformation', person, { query: { broadcaster_id: String(person.id) }, body })));
    return saved.status === 204 ? backTo(`${here}?saved=1`) : backTo(here, 'error', String(saved.body.message));
  }
  if (form) return postChat(ctx, person, person, here, sendChatMessage);
  const error = shownError(ctx, 'error');
  const chatError = shownError(ctx, 'chat_error');
  const url = new URL(ctx.call.request.url);
  const channel = firstOf((await answered(getChannelInformation(asOperation(ctx, 'getChannelInformation', person, { query: { broadcaster_id: String(person.id) } })))).body) ?? {};
  const stream = firstOf((await answered(getStreams(asOperation(ctx, 'getStreams', person, { query: { user_id: String(person.id) } })))).body);
  const query = (url.searchParams.get('category_query') ?? '').trim();
  const found = query ? ((await answered(searchCategories(asOperation(ctx, 'searchCategories', person, { query: { query } })))).body.data as Row[]) : [];
  return twitchPage(ctx, {
    title: 'Stream Manager - Twitch', person,
    body: (
      <div className="dashboard">
        <h1>Stream Manager</h1>
        <section className="panel" aria-label="Stream Preview">
          <h2>Stream Preview</h2>
          <Player ctx={ctx} user={person} stream={stream} />
          <div className="body">
            {stream
              ? <span className="status-live">LIVE</span>
              : <span className="status-offline">OFFLINE</span>}
            {stream ? <span> · <strong>{String(stream.viewer_count)}</strong> Viewers</span> : null}
          </div>
        </section>
        <section className="panel" aria-label="My Chat">
          <h2>My Chat</h2>
          <ChatPanel ctx={ctx} broadcaster={person} action={here} person={person} {...(chatError ? { error: chatError } : {})} />
        </section>
        <section className="panel" aria-label="Edit Stream Info">
          <h2>Edit Stream Info</h2>
          <div className="body">
            {url.searchParams.get('saved') ? <p className="notice" role="status">Stream info updated</p> : null}
            {error ? <p className="error" role="alert">{error}</p> : null}
            <form method="get" action={here} className="field">
              <label htmlFor="category_query">Category</label>
              <div className="inline">
                <input type="text" id="category_query" name="category_query" placeholder="Search for a category" defaultValue={query} />
                <button type="submit" className="button">Search</button>
              </div>
            </form>
            <form method="post" action={here}>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input type="text" id="title" name="title" maxLength={140} defaultValue={String(channel.title ?? '')} />
              </div>
              <fieldset className="field">
                <legend>Category</legend>
                <div className="choices">
                  {channel.game_id ? <label><input type="radio" name="game_id" value={String(channel.game_id)} defaultChecked={!found.length} /> {String(channel.game_name)}</label> : null}
                  {found.filter((c) => c.id !== channel.game_id).map((c, i) => <label key={String(c.id)}><input type="radio" name="game_id" value={String(c.id)} defaultChecked={i === 0} /> {String(c.name)}</label>)}
                  {!channel.game_id && !found.length ? <span>No category</span> : null}
                </div>
              </fieldset>
              <button type="submit" className="button primary" name="intent" value="save">Done</button>
            </form>
          </div>
        </section>
      </div>
    ),
  });
}
