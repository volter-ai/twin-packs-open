// What every family of twitch shares, and its id lane with it (../../id/src/semantics/shared.ts re-exports this): Twitch's
// error body, who a Helix call is made by (the caller ./around.ts resolves, or a twitch.tv page acting as the person
// logged in), the credentials id.twitch.tv issues and Helix honours, the stored shapes (users, channels, streams, chat
// messages) and their views, and the categories Twitch knows.
import { personOf, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };

// ── Twitch's answers ────────────────────────────────────────────────────────────────────────────────────────────────

const REASON: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error' };

/** Twitch's error body: the status's reason phrase, the status and the message. */
// source: https://dev.twitch.tv/docs/api/reference/ "user is already banned"
export function twitchError(status: number, message: string): Response {
  return Response.json({ error: REASON[status] ?? 'Error', status, message }, { status });
}

/** An answer of Twitch's `data` list (and its pagination, when the list pages). */
// source: https://dev.twitch.tv/docs/api/guide/ "If the list API is able to return another page of results, the response includes the pagination field"
export function dataAnswer(data: unknown[], pagination?: Row): Response {
  return Response.json({ data, ...(pagination ? { pagination } : {}) });
}

/** One page of a list as Twitch pages it: `first` items (1 to 100, default 20) from the `after` cursor, and the cursor
 *  of the next page in `pagination` while there is one (an empty Pagination object at the end); or the page's refusal. */
// source: https://dev.twitch.tv/docs/api/guide/ "The Pagination object is empty if there are no more pages to return in the direction you"
export function pageOf(ctx: HandlerContext, rows: unknown[]): Response {
  const url = new URL(ctx.call.request.url);
  const first = url.searchParams.has('first') ? Number(url.searchParams.get('first')) : 20;
  // source: spec:/paths/~1streams/get/parameters/5/description "The minimum page size is 1 item per page and the maximum is 100 items per page."
  if (!Number.isInteger(first) || first < 1 || first > 100) return twitchError(400, 'The first query parameter is outside the allowed range of values.');
  const at = cursorOffset(url.searchParams.get('after'));
  const page = rows.slice(at, at + first);
  return dataAnswer(page, at + first < rows.length ? { cursor: cursorAt(at + first) } : {});
}
// Where the documentation stops: a cursor is opaque ("eyJiI..." in the guide's example); the twin's is base64 JSON naming
// the offset of the page it starts.
const cursorAt = (offset: number): string => btoa(JSON.stringify({ a: { Offset: offset } }));
function cursorOffset(cursor: string | null): number {
  if (!cursor) return 0;
  try { const n = Number((JSON.parse(atob(cursor)) as { a?: { Offset?: unknown } }).a?.Offset); return Number.isInteger(n) && n >= 0 ? n : 0; } catch { return 0; }
}

// ── who is calling ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Who a Helix call is made by: an app access token (no user), a user access token (its user and scopes), each issued to
 *  an application (its client id); or Twitch's own web client acting as the person logged in to twitch.tv (`firstParty`,
 *  with the whole of the account's authority). */
export type Caller = { kind: 'app' | 'user'; clientId: string; userId?: string; scopes: string[]; firstParty?: true };

/** The header ./around.ts names the resolved caller in; it strips the header from every request it is sent, so only its
 *  own resolution (or a twitch.tv page's, which calls the handler itself) reaches a handler. */
export const CALLER_HEADER = 'x-volter-twitch-caller';

export function callerOf(ctx: HandlerContext): Caller | undefined {
  try { return JSON.parse(ctx.call.request.headers.get(CALLER_HEADER) ?? 'null') as Caller | undefined ?? undefined; } catch { return undefined; }
}

/** The refusal when an operation that requires a user access token with `scope` is called otherwise: no user token, or
 *  one without the scope (each operation's 401, in its own words). */
export function userTokenRefusal(caller: Caller, scope: string, words: { user: string; scope: string }): Response | undefined {
  if (caller.firstParty) return undefined;
  if (caller.kind !== 'user') return twitchError(401, words.user);
  if (!caller.scopes.includes(scope)) return twitchError(401, words.scope);
  return undefined;
}

/** A query parameter as Twitch reads one that may repeat (`id=1234&id=5678`): every value given. */
// source: https://dev.twitch.tv/docs/api/guide/ "you must specify the query parameter for each value in the list; the list is not comma delimited"
export function queryValues(ctx: HandlerContext, name: string): string[] {
  return new URL(ctx.call.request.url).searchParams.getAll(name).filter((v) => v !== '');
}

// ── credentials ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The bookkeeping a credential is kept as, each by the SHA-256 of what Twitch handed out. */
export const TOKEN = '_token';
export const AUTHORIZATION_CODE = '_authorization_code';
export const CLIENT_SECRET = '_client_secret';
export const STREAM_KEY = '_stream_key';

export const digestOf = (ctx: Pick<HandlerContext, 'crypto'>, value: string): string => ctx.crypto.sha256(value);

/** A credential Twitch hands out (a token, a code, a client id or secret): `length` lowercase letters and digits drawn
 *  from the World's secret for `label`, never from ids anyone could see. The reference's examples show them so
 *  ("Bearer 2gbdx6oar67tqtcmt49t3wpcgycthx", "Client-Id: wbmytr93xzw8zbg0p1izqyzzc5mbiz", 30 characters). */
export async function credentialString(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string, length = 30): Promise<string> {
  return ctx.crypto.base62From(await ctx.secret(label), length).toLowerCase();
}

/** How long a token lasts, in seconds: a user access token about four hours (the authorization code example's 14124), an
 *  app access token weeks (the client credentials example's 5011271). */
// source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "All access tokens obtained have the same expiry like before, i.e. 4 hours"
export const USER_TOKEN_SECONDS = 14124;
// source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "5011271"
export const APP_TOKEN_SECONDS = 5011271;

/** The access token a request presents, as it is held: issued, not revoked, not expired; undefined otherwise. */
export function heldAccessToken(ctx: Pick<HandlerContext, 'row' | 'crypto' | 'occurredAt'>, token: string): Row | undefined {
  if (!token) return undefined;
  const row = ctx.row(TOKEN, digestOf(ctx, token));
  if (!row || row.kind !== 'access' || row.status !== 'active') return undefined;
  return Date.parse(String(row.expires_at)) > Date.parse(ctx.occurredAt) ? row : undefined;
}

/** A channel's stream key: `live_`, the broadcaster's id and sixteen letters and digits drawn from the World's secret for
 *  the channel, the form Get Stream Key's example answers ("live_44322889_a34ub37c8ajv98a0"). It is never stored: the
 *  ingest finds the channel a key names by its SHA-256 (`_stream_key`, which the account's sign-up records). */
// source: https://dev.twitch.tv/docs/api/reference/ "live_44322889_a34ub37c8ajv98a0"
export async function streamKeyOf(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, userId: string): Promise<string> {
  return `live_${userId}_${await credentialString(ctx, `stream-key:${userId}`, 16)}`;
}

/** The seconds a held token has left. */
export const secondsLeft = (row: Row, now: string): number => Math.max(0, Math.floor((Date.parse(String(row.expires_at)) - Date.parse(now)) / 1000));

// ── accounts and channels ───────────────────────────────────────────────────────────────────────────────────────────

/** A login as Twitch keeps it: lowercase. */
export const loginOf = (value: string): string => value.trim().replace(/^@/, '').toLowerCase();

const live = (rows: Row[]): Row[] => rows.filter((r) => r.deleted !== true);
export const usersOf = (ctx: Pick<HandlerContext, 'rowsRaw'>): Row[] => live(ctx.rowsRaw('user'));
export const userByLogin = (ctx: Pick<HandlerContext, 'rowsRaw'>, login: string): Row | undefined => usersOf(ctx).find((u) => u.login === loginOf(login));
export const userById = (ctx: Pick<HandlerContext, 'rowsRaw'>, id: string): Row | undefined => usersOf(ctx).find((u) => u.id === id);
export const channelOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, id: string): Row | undefined => live(ctx.rowsRaw('channel')).find((c) => c.broadcaster_id === id);
/** The channel's live stream: present only while it is broadcasting. */
export const liveStreamOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, userId: string): Row | undefined => live(ctx.rowsRaw('stream')).find((s) => s.user_id === userId);

/** A channel's broadcasts as the World recorded them, oldest first, by their stream ids (a bandwidth test is none). */
export function broadcastsOf(ctx: Pick<HandlerContext, 'live' | 'row' | 'crypto'>, userId: string): string[] {
  return ctx.live.recordings()
    .filter((r) => !r.stream.startsWith('bandwidthtest-') && ctx.row(STREAM_KEY, digestOf(ctx, r.key))?.user_id === userId)
    .map((r) => r.stream);
}

/** A user as Get Users answers one; its email only to a user access token for that user with user:read:email. */
// source: spec:/components/schemas/GetUsersResponseData/properties/email "The object includes this field only if the user access token includes the user:read:email scope."
export function userView(row: Row, withEmail: boolean): Row {
  const keys = ['id', 'login', 'display_name', 'type', 'broadcaster_type', 'description', 'profile_image_url', 'offline_image_url', 'view_count', ...(withEmail ? ['email'] : []), 'created_at'];
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

/** A channel as Get Channel Information answers one. */
export function channelView(row: Row): Row {
  const keys = ['broadcaster_id', 'broadcaster_login', 'broadcaster_name', 'broadcaster_language', 'game_id', 'game_name', 'title', 'delay', 'tags', 'content_classification_labels', 'is_branded_content'];
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

/** A stream as Get Streams answers one. */
export function streamView(row: Row): Row {
  const keys = ['id', 'user_id', 'user_login', 'user_name', 'game_id', 'game_name', 'type', 'title', 'tags', 'viewer_count', 'started_at', 'language', 'thumbnail_url', 'tag_ids', 'is_mature'];
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

// ── who is logged in to twitch.tv ───────────────────────────────────────────────────────────────────────────────────

/** The session cookie twitch.tv's pages name a person by, set at log-in for every twitch.tv host (www, dashboard, id).
 *  Where the documentation stops: Twitch documents no cookie; the twin's is `auth-token`, the name twitch.tv's own web
 *  client keeps its session under. */
export const SESSION_COOKIE = 'auth-token';

/** The account the request's session cookie names, or undefined when nobody is logged in. */
export function sessionUser(ctx: Pick<HandlerContext, 'call' | 'rowsRaw'>): Row | undefined {
  const pair = (ctx.call.request.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = pair?.slice(SESSION_COOKIE.length + 1);
  const session = token ? ctx.rowsRaw('_web_session').find((s) => s.token === token && s.deleted !== true) : undefined;
  const person = session ? personOf(ctx as HandlerContext, String(session.email)) : undefined;
  return typeof person?.user_id === 'string' ? userById(ctx, person.user_id) : undefined;
}

// ── categories ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The categories Twitch knows, as Search Categories answers them. Where the documentation stops: Twitch publishes no
 *  catalog of its categories; the twin knows the ones the reference's examples name, each by the id and name they give
 *  it, its box art at the address form Search Categories' example answers. */
// source: https://dev.twitch.tv/docs/api/reference/ "https://static-cdn.jtvnw.net/ttv-boxart/33214-52x72.jpg"
export const CATEGORIES: ReadonlyArray<{ id: string; name: string }> = [
  // source: https://dev.twitch.tv/docs/api/reference/ "Fortnite"
  { id: '33214', name: 'Fortnite' },
  // source: https://dev.twitch.tv/docs/api/reference/ "Software and Game Development"
  { id: '1469308723', name: 'Software and Game Development' },
  // source: https://dev.twitch.tv/docs/api/reference/ "Science & Technology"
  { id: '509670', name: 'Science & Technology' },
  // source: https://dev.twitch.tv/docs/api/reference/ "Talk Shows & Podcasts"
  { id: '417752', name: 'Talk Shows & Podcasts' },
  // source: https://dev.twitch.tv/docs/api/reference/ "Grand Theft Auto V"
  { id: '32982', name: 'Grand Theft Auto V' },
  // source: https://dev.twitch.tv/docs/api/reference/ "Little Nightmares"
  { id: '494131', name: 'Little Nightmares' },
  // source: https://dev.twitch.tv/docs/api/reference/ "DOOM Eternal"
  { id: '506442', name: 'DOOM Eternal' },
  // source: https://dev.twitch.tv/docs/api/reference/ "PUBG: BATTLEGROUNDS"
  { id: '493057', name: 'PUBG: BATTLEGROUNDS' },
];
export const boxArtOf = (id: string): string => `https://static-cdn.jtvnw.net/ttv-boxart/${id}-52x72.jpg`;
export const categoryById = (id: string): { id: string; name: string } | undefined => CATEGORIES.find((c) => c.id === id);

/** The categories a query matches: every part of it in the name, without case. */
// source: spec:searchCategories "name must contain all parts of the query string."
// source: spec:searchCategories "The comparison is case insensitive."
export function categoriesMatching(query: string): Array<{ id: string; name: string }> {
  const parts = query.toLowerCase().split(/\s+/).filter(Boolean);
  return CATEGORIES.filter((c) => parts.every((p) => c.name.toLowerCase().includes(p)));
}

// ── chat ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A channel's chat messages, oldest first. */
export const chatOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, broadcasterId: string): Row[] =>
  live(ctx.rowsRaw('chat_message')).filter((m) => m.broadcaster_id === broadcasterId).sort((a, b) => Number(a.sent_at_ms) - Number(b.sent_at_ms));

/** The most a chat message may hold. */
// source: spec:/components/schemas/SendChatMessageBody/properties/message "The message is limited to a maximum of 500 characters."
export const CHAT_MESSAGE_LIMIT = 500;
