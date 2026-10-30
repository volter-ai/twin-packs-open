// The creator dashboard's stream settings (a workspace): dashboard.twitch.tv/u/<login>/settings/stream, where a streamer
// finds the channel's Primary Stream key to give their encoder (the stream rig's stream-key.txt).
//
//   GET /u/<login>/settings/stream          Stream Key & Preferences: the Primary Stream key, hidden, with Show and Copy
//   GET /u/<login>/settings/stream?show=1   the same with the key shown
//
// The key is Get Stream Key's, made as the streamer. Where the documentation stops: the settings page is twitch.tv's own
// client; its labels are Twitch's own. Resetting the key and the page's other preferences (disconnect protection, past
// broadcasts, latency) are not drawn: no act of the demand reaches them.
import type { HandlerContext } from '@volter/world-core';
import { getStreamKey } from '../semantics/streams.ts';
import { answered, asOperation, firstOf, linkTo, notFoundPage, personOn, toLogIn, twitchPage, type Row } from './shared.tsx';

/** The key's Copy: the browser's clipboard (the page's one script). */
const COPY = "document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(document.getElementById(b.getAttribute('data-copy')).value)})})";

export async function screen(ctx: HandlerContext): Promise<Response> {
  const login = String((ctx.call.params as Row).login ?? '').toLowerCase();
  const person = personOn(ctx);
  if (!person) return toLogIn(ctx);
  if (person.login !== login) return notFoundPage(ctx, person);
  const key = String(firstOf((await answered(getStreamKey(asOperation(ctx, 'getStreamKey', person, { query: { broadcaster_id: String(person.id) } })))).body)?.stream_key ?? '');
  const here = linkTo('dashboard.twitch.tv', `/u/${login}/settings/stream`, ctx);
  const shown = new URL(ctx.call.request.url).searchParams.get('show') === '1';
  return twitchPage(ctx, {
    title: 'Stream - Settings - Twitch', person,
    body: (
      <div className="dashboard">
        <h1>Stream</h1>
        <section className="panel" aria-label="Stream Key & Preferences">
          <h2>Stream Key &amp; Preferences</h2>
          <div className="body">
            <div className="field">
              <label htmlFor="stream-key">Primary Stream key</label>
              <input id="stream-key" className="key" type={shown ? 'text' : 'password'} readOnly value={key} data-testid="stream-key" />
            </div>
            <div className="inline">
              <form method="get" action={here}><input type="hidden" name="show" value={shown ? '0' : '1'} /><button type="submit" className="button">{shown ? 'Hide' : 'Show'}</button></form>
              <button type="button" className="button primary" data-copy="stream-key">Copy</button>
            </div>
            <script dangerouslySetInnerHTML={{ __html: COPY }} />
          </div>
        </section>
      </div>
    ),
  });
}
