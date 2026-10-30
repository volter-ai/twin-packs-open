// What twitch.tv's pages share (docs/contributing/architecture.md, "Screens"): Twitch's dark skin and its top bar, where
// a page is (twitch.tv's own hosts, or a World's place), who is logged in, a Helix operation made as that person (Twitch's
// own web client acts with the whole of the account's authority), the player a broadcast plays in (world-ui's
// LivePlayer) and the chat panel the channel page, its popout and the stream manager draw, kept current as messages land
// (world-ui's LiveRegion, answered by liveFragment). Every page is drawn on the server; a form posts and the page that
// answers redirects back.
import { twinVendorUrl, type HandlerContext } from '@volter/world-core';
import { flowPage, LIVE_PLAYER_CSS, liveFragment, LivePlayer, LiveRegion } from '@volter/world-ui';
import surface from '../generated/surface.gen.json' with { type: 'json' };
import { broadcastsOf, CALLER_HEADER, chatOf, SESSION_COOKIE, sessionUser, type Caller, type Row } from '../semantics/shared.ts';

export type { Row };

// ── the skin ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** twitch.tv's dark theme: its near-black ground, its purple, its type. Where the documentation stops: twitch.tv's look
 *  is its own client's, no document describes it; the colours and labels here are Twitch's own. */
export const TWITCH_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0e0e10;color:#efeff1;font:13px/1.5 Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif}
a{color:#bf94ff;text-decoration:none}a:hover{text-decoration:underline}
.top-nav{height:50px;display:flex;align-items:center;gap:16px;padding:0 12px;background:#18181b;box-shadow:0 1px 2px rgba(0,0,0,.9);position:sticky;top:0;z-index:2}
.top-nav .logo{display:flex;color:#9147ff}.top-nav .nav-link{color:#efeff1;font-weight:600;font-size:15px}
.top-nav .search{flex:1;display:flex;justify-content:center}.top-nav .search input{width:min(380px,100%);background:#ffffff1a;border:0;border-radius:6px;padding:6px 10px;color:#efeff1}
.top-nav .account{display:flex;align-items:center;gap:8px}
.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:4px;padding:5px 10px;font:600 13px Inter,sans-serif;cursor:pointer;background:#ffffff26;color:#efeff1}
.button.primary{background:#9147ff;color:#fff}.button.primary:hover{background:#772ce8}
.avatar{border-radius:50%;display:inline-block;flex:none;overflow:hidden}
.layout{display:flex;min-height:calc(100vh - 50px)}
.main{flex:1;min-width:0}
.player{--live-player-background:#000;max-height:calc(100vh - 160px)}
.embed .player{width:100%;height:100vh;max-height:none;aspect-ratio:auto}
.offline-player{background:#000;aspect-ratio:16/9;max-height:calc(100vh - 160px);display:flex;align-items:center;justify-content:center;color:#adadb8;text-align:center}
.offline-player .badge{display:inline-block;background:#0e0e10cc;color:#efeff1;font-weight:600;padding:2px 6px;border-radius:4px;margin-bottom:8px;letter-spacing:.04em}
.channel-info{display:flex;gap:12px;padding:16px 20px;align-items:flex-start}
.channel-info h1{font-size:18px;margin:0;font-weight:700}.channel-info .title{font-size:15px;font-weight:600;margin:2px 0}
.live-badge{background:#eb0400;color:#fff;font-weight:700;font-size:11px;padding:0 5px;border-radius:4px;text-transform:uppercase;vertical-align:middle}
.stats{margin-left:auto;text-align:right;color:#adadb8}.stats .viewers{color:#ff8280;font-weight:600}
.category{color:#bf94ff}
.chat{width:340px;flex:none;background:#18181b;border-left:1px solid #2f2f35;display:flex;flex-direction:column;height:calc(100vh - 50px);position:sticky;top:50px}
.chat.popout{width:100%;height:100vh;top:0;border:0}
.chat-header{height:50px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #2f2f35;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.06em;position:relative}
.chat-header .popout-link{position:absolute;right:10px;font-size:11px;text-transform:none;letter-spacing:0}
.chat-lines{flex:1;overflow-y:auto;padding:10px 0;margin:0;list-style:none}
.chat-line{padding:4px 20px;word-wrap:break-word}.chat-line .name{font-weight:700}.chat-line .badge{display:inline-block;background:#e91916;color:#fff;font-size:10px;font-weight:700;border-radius:3px;padding:0 3px;margin-right:4px}
.chat-welcome{color:#adadb8;padding:4px 20px}
.chat-composer{padding:10px 20px 20px;display:flex;flex-direction:column;gap:8px}
.chat-composer textarea{resize:none;background:#ffffff1a;border:2px solid transparent;border-radius:6px;color:#efeff1;padding:8px 10px;font:inherit;min-height:40px}
.chat-composer textarea:focus{border-color:#9147ff;background:#000;outline:0}
.chat-composer .row{display:flex;justify-content:flex-end}
.dashboard{padding:20px;display:grid;grid-template-columns:2fr 1fr;gap:16px}
.dashboard h1{grid-column:1/-1;margin:0;font-size:24px}
.panel{background:#18181b;border-radius:6px;overflow:hidden}.panel h2{margin:0;padding:10px 14px;font-size:13px;border-bottom:1px solid #2f2f35}
.panel .body{padding:14px}.panel .chat{width:100%;height:520px;position:static;border:0}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}.field label,.field legend{font-weight:600}
.field input[type=text]{background:#ffffff1a;border:2px solid transparent;border-radius:6px;color:#efeff1;padding:6px 10px;font:inherit}
.field input[type=text]:focus{border-color:#9147ff;outline:0}
fieldset.field{border:0;padding:0;margin:0 0 12px}
.choices{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.inline{display:flex;gap:8px}
.notice{background:#00f59333;border-left:4px solid #00f593;padding:8px 12px;margin:0 0 12px}
.error{background:#eb040033;border-left:4px solid #eb0400;padding:8px 12px;margin:0 0 12px}
.not-found{padding:80px 20px;text-align:center;color:#adadb8}
.status-live{color:#ff8280;font-weight:700}.status-offline{color:#adadb8;font-weight:700}
.key{font-family:ui-monospace,Consolas,monospace;background:#ffffff1a;border-radius:6px;padding:6px 10px;color:#efeff1;border:0;width:100%}
`;

/** Twitch's glitch mark (the brand's own glyph, as simple-icons draws it). */
export const TWITCH_LOGO_PATH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z';
export const TwitchLogo = () => <svg width="28" height="32" viewBox="0 0 24 24" aria-label="Twitch" role="img"><path fill="currentColor" d={TWITCH_LOGO_PATH} /></svg>;

/** An account's avatar as the page draws it: its first letter on a colour drawn from its id. Where the documentation
 *  stops: an account's picture is served by Twitch's image host, which the twin does not serve; the page draws it. */
export function Avatar({ user, size }: { user: Row | undefined; size: number }) {
  const hue = [...String(user?.id ?? '0')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <rect width="40" height="40" fill={`hsl(${hue} 60% 45%)`} />
        <text x="20" y="27" textAnchor="middle" fontSize="20" fontWeight="700" fill="#fff" fontFamily="Inter,Arial,sans-serif">{String(user?.display_name ?? '?').slice(0, 1).toUpperCase()}</text>
      </svg>
    </span>
  );
}

// ── where a page is ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The hosts twitch.tv's pages are on. */
export const TWITCH_HOSTS = ['www.twitch.tv', 'twitch.tv', 'm.twitch.tv', 'dashboard.twitch.tv', 'id.twitch.tv'];

/** The host a request names (the one the World routed it from, else its own). */
export function hostOf(request: Request): string {
  return (request.headers.get('x-volter-twin-original-host') ?? new URL(request.url).hostname).toLowerCase().replace(/:\d+$/, '');
}

/** The World's place the page is reached at (its base path, without the trailing slash), or undefined on twitch.tv's
 *  own hosts. At a place, every host's pages are under the one base, by their paths. */
export function placeOf(ctx: HandlerContext): string | undefined {
  const prefix = ctx.call.request.headers.get('x-forwarded-prefix');
  if (!prefix || !/^\/[A-Za-z0-9._~/-]*$/.test(prefix) || TWITCH_HOSTS.includes(hostOf(ctx.call.request))) return undefined;
  return new URL(ctx.publicBase).pathname.replace(/\/+$/, '');
}

/** A path of this site as one path: its dot segments resolved and its leading slashes one. */
export function onePath(path: string): string {
  const url = new URL(path, 'https://www.twitch.tv');
  return `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`;
}

/** Where a link to one of Twitch's pages goes: at a World's place its path on the base, else its own host and path
 *  (a page on www.twitch.tv linking the dashboard names dashboard.twitch.tv). */
export function linkTo(host: string, path: string, ctx: HandlerContext): string {
  const placed = placeOf(ctx);
  if (placed !== undefined) return `${placed}${onePath(path)}`;
  return hostOf(ctx.call.request) === host ? onePath(path) : `https://${host}${onePath(path)}`;
}

/** Where a page asks Twitch's media hosts: at a World's place, under the content route; else the vendor's URL as the
 *  World serves it (on a hosted site, on the page's origin). */
export function mediaUrl(ctx: HandlerContext, host: string, path: string): string {
  const placed = placeOf(ctx);
  return placed !== undefined ? `${placed}/@${host}${path}` : twinVendorUrl(ctx.call.request, `https://${host}${path}`);
}

/** A move to one of Twitch's pages. */
export function moveTo(host: string, path: string, ctx: HandlerContext, status = 302): Response {
  return new Response(null, { status, headers: { location: linkTo(host, path, ctx) } });
}

/** A visitor nobody logged in sent to the log-in, which returns them here. */
export function toLogIn(ctx: HandlerContext): Response {
  const url = new URL(ctx.call.request.url);
  const placed = placeOf(ctx);
  const here = placed === undefined ? `https://${hostOf(ctx.call.request)}${url.pathname}${url.search}` : `${url.pathname.slice(placed.length) || '/'}${url.search}`;
  return moveTo('www.twitch.tv', `/login?redirect=${encodeURIComponent(here)}`, ctx);
}

/** A page of twitch.tv: its top bar (the mark, Browse, the search, the person logged in or Log In) over the page's body. */
export function twitchPage(ctx: HandlerContext, options: { title: string; body: Parameters<typeof flowPage>[0]['body']; person?: Row; status?: number; bare?: boolean }): Response {
  const person = options.person;
  const nav = options.bare ? null : (
    <nav className="top-nav">
      <a className="logo" href={linkTo('www.twitch.tv', '/', ctx)}><TwitchLogo /></a>
      <span className="nav-link">Browse</span>
      <div className="search"><input type="search" placeholder="Search" aria-label="Search Input" /></div>
      <div className="account">
        {person
          ? <a href={linkTo('dashboard.twitch.tv', `/u/${String(person.login)}/stream-manager`, ctx)} className="nav-link" title="Creator Dashboard"><Avatar user={person} size={30} /></a>
          : <a className="button" href={linkTo('www.twitch.tv', '/login', ctx)}>Log In</a>}
      </div>
    </nav>
  );
  return flowPage({ title: options.title, css: [TWITCH_CSS, LIVE_PLAYER_CSS], status: options.status ?? 200, headers: { 'cache-control': 'no-cache, no-store' }, body: <>{nav}{options.body}</> });
}

/** Twitch's page for a channel or a page that is not there. */
// Where the documentation stops: the words are twitch.tv's own for content that is unavailable.
export function notFoundPage(ctx: HandlerContext, person?: Row): Response {
  return twitchPage(ctx, { title: 'Twitch', status: 404, ...(person ? { person } : {}), body: <div className="not-found"><h1>Sorry. Unless you’ve got a time machine, that content is unavailable.</h1></div> });
}

// ── who is on the page ──────────────────────────────────────────────────────────────────────────────────────────────

/** The account logged in at twitch.tv, by the session cookie. */
export const personOn = (ctx: HandlerContext): Row | undefined => sessionUser(ctx);

/** The session cookie as twitch.tv sets it: for every twitch.tv host (Domain=.twitch.tv), so a person logged in at
 *  www.twitch.tv is logged in at the dashboard and at id.twitch.tv; at a World's place the kernel keeps it to the base. */
export function sessionAcrossHosts(answer: Response, ctx: HandlerContext): Response {
  if (placeOf(ctx) !== undefined || !hostOf(ctx.call.request).endsWith('twitch.tv')) return answer;
  const headers = new Headers(answer.headers);
  const cookies = headers.getSetCookie();
  headers.delete('set-cookie');
  for (const cookie of cookies) headers.append('set-cookie', cookie.startsWith(`${SESSION_COOKIE}=`) ? `${cookie}; Domain=.twitch.tv` : cookie);
  return new Response(answer.body, { status: answer.status, headers });
}

// ── an operation, made by the person on the page ────────────────────────────────────────────────────────────────────

type SurfaceOperation = { id: string; method: string; path: string };

/** A Helix operation as twitch.tv's own client makes it for the person logged in: the operation's own path, query and
 *  JSON body, its caller the person with the account's whole authority (or nobody, for a page's public read). */
export function asOperation(ctx: HandlerContext, operationId: string, person: Row | undefined, call: { query?: Record<string, string>; body?: Record<string, unknown> } = {}): HandlerContext {
  const operation = (surface as unknown as { operations: SurfaceOperation[] }).operations.find((o) => o.id === operationId)!;
  const url = new URL(`https://api.twitch.tv/helix${operation.path}`);
  for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value);
  const caller: Caller = person ? { kind: 'user', clientId: 'twitch.tv', userId: String(person.id), scopes: [], firstParty: true } : { kind: 'app', clientId: 'twitch.tv', scopes: [], firstParty: true };
  const headers = new Headers({ [CALLER_HEADER]: JSON.stringify(caller) });
  const text = call.body ? JSON.stringify(call.body) : '';
  if (call.body) headers.set('content-type', 'application/json');
  const request = new Request(url, { method: operation.method.toUpperCase(), headers, ...(call.body ? { body: text } : {}) });
  return { ...ctx, call: { ...ctx.call, request, operation: operation as never, params: {} }, params: Object.fromEntries(url.searchParams), body: call.body, text };
}

/** An operation's answer, read: its status and its JSON. */
export async function answered(response: Promise<Response>): Promise<{ status: number; body: Row }> {
  const res = await response;
  return { status: res.status, body: (res.status === 204 ? {} : await res.json()) as Row };
}

/** The first item of an answer's `data`. */
export const firstOf = (body: Row): Row | undefined => (Array.isArray(body.data) ? body.data[0] as Row | undefined : undefined);

/** A form a page posted, by field (URL-encoded, as a browser posts a form). */
export const formOf = (ctx: HandlerContext): Record<string, string> => Object.fromEntries(new URLSearchParams(ctx.text));

// ── the broadcast ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The channel's broadcast in its player (world-ui's LivePlayer), given its playlist on Twitch's playback host
 *  (./video.ts): the live broadcast while the channel is live, else the next one it starts, which the player waits for
 *  under the offline words. */
export function Player({ ctx, user, stream }: { ctx: HandlerContext; user: Row; stream: Row | undefined }) {
  const broadcast = stream ? String(stream.id) : `after-${broadcastsOf(ctx, String(user.id)).at(-1) ?? '0'}`;
  const waiting = stream ? 'Loading...' : `${String(user.display_name)} is offline.`;
  return <LivePlayer className="player" src={mediaUrl(ctx, 'usher.ttvnw.net', `/api/channel/hls/${String(user.login)}/${broadcast}/index.m3u8`)} label="Video Player" testId="video-player" messages={{ waiting, ended: `${String(user.display_name)} is offline.`, error: 'This video is unavailable' }} />;
}

// ── the chat panel ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One chat message as the panel shows it: the broadcaster's badge, the sender's name in their colour, the message. */
function ChatLine({ m }: { m: Row }) {
  const color = /^#[0-9a-f]{6}$/i.test(String(m.color ?? '')) ? String(m.color) : '#bf94ff';
  return (
    <li className="chat-line" data-message-id={String(m.id)}>
      {String(m.badges ?? '').includes('broadcaster') ? <span className="badge" title="Broadcaster">B</span> : null}
      <span className="name" style={{ color }}>{String(m.sender_name)}</span>: <span className="text">{String(m.message)}</span>
    </li>
  );
}

/** The chat's lines after the message `after` (all of them when undefined), and the last one's id, its cursor. */
function linesAfter(ctx: HandlerContext, broadcasterId: string, after: string | undefined): { lines: Row[]; cursor: string } {
  const all = chatOf(ctx, broadcasterId);
  const from = after === undefined ? 0 : all.findIndex((m) => m.id === after) + 1;
  return { lines: all.slice(from), cursor: String(all.at(-1)?.id ?? '') };
}

/** The answer to the chat region's held read (`?live=chat&after=<last message id>`): the messages sent since, appended. */
export function chatFragment(ctx: HandlerContext, broadcaster: Row): Promise<Response> | undefined {
  return liveFragment(ctx, 'chat', {
    resources: ['chat_message'], mode: 'append',
    cursor: () => linesAfter(ctx, String(broadcaster.id), undefined).cursor,
    render: (after) => <>{linesAfter(ctx, String(broadcaster.id), after || undefined).lines.map((m) => <ChatLine key={String(m.id)} m={m} />)}</>,
  });
}

/** A channel's chat as its panel shows it: "Stream Chat", the messages sent (a LiveRegion, so a message sent while the
 *  page is open appears in it), and for a person logged in the box to send one, posting to `action`. */
export function ChatPanel({ ctx, broadcaster, action, person, popout, error }: { ctx: HandlerContext; broadcaster: Row; action: string; person?: Row; popout?: boolean; error?: string }) {
  const { lines, cursor } = linesAfter(ctx, String(broadcaster.id), undefined);
  return (
    <aside className={`chat${popout ? ' popout' : ''}`} aria-label="Stream Chat">
      <div className="chat-header">Stream Chat{popout ? null : <a className="popout-link" href={linkTo('www.twitch.tv', `/popout/${String(broadcaster.login)}/chat?popout=`, ctx)} target="_blank">Popout Chat</a>}</div>
      <div className="chat-welcome">Welcome to the chat room!</div>
      <LiveRegion name="chat" as="ul" mode="append" cursor={cursor} className="chat-lines" label="Chat messages">
        {lines.map((m) => <ChatLine key={String(m.id)} m={m} />)}
      </LiveRegion>
      {person
        ? (
          <form className="chat-composer" method="post" action={action}>
            {error ? <div className="error" role="alert">{error}</div> : null}
            <textarea name="message" aria-label="Send a message" placeholder="Send a message" maxLength={500} />
            <div className="row"><button type="submit" className="button primary" name="intent" value="chat">Chat</button></div>
          </form>
        )
        : <div className="chat-composer"><a className="button primary" href={linkTo('www.twitch.tv', '/login', ctx)}>Log In to Chat</a></div>}
    </aside>
  );
}

/** Back to a page after its form posted (post, redirect, get), with Twitch's words for a refusal in `name`. */
export function backTo(page: string, name?: string, words?: string): Response {
  const url = new URL(page, 'https://www.twitch.tv');
  if (name && words) url.searchParams.set(name, words);
  return new Response(null, { status: 303, headers: { location: page.startsWith('http') ? url.href : `${url.pathname}${url.search}` } });
}

/** The chat box's "Chat": the message sent to the channel's chat as the person logged in, then back to the page, with
 *  Twitch's refusal in its own words (`chat_error`) when it was not sent. A visitor is sent to log in first. */
export async function postChat(ctx: HandlerContext, broadcaster: Row, person: Row | undefined, back: string, send: (ctx: HandlerContext) => Promise<Response>): Promise<Response> {
  if (!person) return toLogIn(ctx);
  const message = (formOf(ctx).message ?? '').trim();
  const sent = message ? await answered(send(asOperation(ctx, 'sendChatMessage', person, { body: { broadcaster_id: broadcaster.id, sender_id: person.id, message } }))) : { status: 200, body: {} };
  return backTo(back, 'chat_error', sent.status === 200 ? undefined : String(sent.body.message));
}

/** The refusal a page shows from its last post (`chat_error`, `error`), if any. */
export const shownError = (ctx: HandlerContext, name: string): string | undefined => new URL(ctx.call.request.url).searchParams.get(name) ?? undefined;
