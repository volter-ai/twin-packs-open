// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"): what Twitch's own pages and its
// audience do that its API does not. Twitch's sign-up page (an account, its channel and its stream key) and its developer
// console (an application, its client id and secret) have no API; nor does the number of people watching a stream.
import { personOf, personWith, recordPerson, type HandlerContext } from '@volter/world-core';
import { CLIENT_SECRET, credentialString, digestOf, liveStreamOf, loginOf, STREAM_KEY, streamKeyOf, userByLogin, userView, type Row } from './shared.ts';

export type { HandlerContext };

const refuse = (status: number, message: string): Response => Response.json({ error: message }, { status });

/** An account as Twitch's sign-up makes it: the user (in Get Users' shape), its channel, its stream key's record, and the
 *  person who logs in with its password. */
async function signUp(ctx: HandlerContext, body: Row, door: string): Promise<Row | Response> {
  const login = loginOf(String(body.login ?? ''));
  const password = String(body.password ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  // the sign-up's fields: a username (a login, 4 to 25 letters, digits and underscores), a password and an email
  if (!/^[a-z0-9_]{4,25}$/.test(login)) return refuse(400, 'login: 4 to 25 letters, digits or underscores');
  if (!password) return refuse(400, 'password is required');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return refuse(400, 'email is required');
  const taken = userByLogin(ctx, login);
  if (taken) return takenLogin(ctx, taken, password);
  const displayName = typeof body.display_name === 'string' && body.display_name.toLowerCase() === login ? body.display_name : login;
  const createdAt = ctx.occurredAt.replace(/\.\d{3}Z$/, 'Z');
  // source: spec:/components/schemas/GetUsersResponseData/properties/created_at/description "The timestamp is in RFC3339 format."
  // Where the documentation stops: an account without its own picture shows Twitch's default one, from Twitch's image
  // host; the twin names one there per account and draws its pages' avatars itself.
  const user = await ctx.create('GetUsersResponseData', (id) => ({
    login, display_name: displayName, type: '', broadcaster_type: '', description: '',
    profile_image_url: `https://static-cdn.jtvnw.net/user-default-pictures-uv/${ctx.crypto.uuidFrom(`twitch-avatar:${id}`)}-profile_image-300x300.png`,
    offline_image_url: '', view_count: 0, email, created_at: createdAt, chat_color: '',
  }), door);
  const id = String(user.id);
  // every account is a channel: its information as Get Channel Information answers a channel that never streamed
  // source: spec:/components/schemas/GetChannelInformationResponseData/properties/title/description "The value is an empty string if the broadcaster has never streamed."
  // source: spec:/components/schemas/GetChannelInformationResponseData/properties/game_id/description "The value is an empty string if the broadcaster has never played a game."
  await ctx.write('GetChannelInformationResponseData', id, {
    broadcaster_id: id, broadcaster_login: login, broadcaster_name: displayName, broadcaster_language: 'en',
    game_id: '', game_name: '', title: '', delay: 0, tags: [], content_classification_labels: [], is_branded_content: false,
  }, door);
  await ctx.record(STREAM_KEY, { user_id: id }, digestOf(ctx, await streamKeyOf(ctx, id)));
  await recordPerson(ctx, email, password, { user_id: id });
  return { ...user, id };
}

/** A login already taken: the account it names when the password is its own (the same door at every boot), else a
 *  refusal. */
function takenLogin(ctx: HandlerContext, taken: Row, password: string): Row | Response {
  const person = personOf(ctx, String(taken.email));
  return person && person.user_id === taken.id && personWith(ctx, String(taken.email), password) ? taken : refuse(409, `${String(taken.login)} is taken`);
}

/** POST /_twin/console: an account and an application registered in its developer console (the World's credential
 *  door): Twitch's Register Your Application (a name, its OAuth redirect URLs), its client id and the client secret the
 *  console makes. The same account and application at every boot. */
export async function developerConsole(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row;
  const account = await signUp(ctx, body, 'developerConsole');
  if (account instanceof Response) return account;
  const app = (body.application ?? {}) as Row;
  const name = String(app.name ?? '').trim();
  const redirects = Array.isArray(app.redirect_uris) ? app.redirect_uris.map(String) : [];
  if (!name) return refuse(400, 'application.name is required');
  if (!redirects.length || redirects.some((r) => !/^https?:\/\//.test(r))) return refuse(400, 'application.redirect_uris: one or more http(s) URLs');
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "registered client ID"
  const clientId = await credentialString(ctx, `client-id:${account.id}:${name}`);
  const clientSecret = await credentialString(ctx, `client-secret:${clientId}`);
  if (!ctx.row('application', clientId)) {
    await ctx.write('application', clientId, { client_id: clientId, name, owner_id: account.id, redirect_uris: redirects, client_type: 'confidential', created_at: ctx.occurredAt }, 'developerConsole');
    await ctx.record(CLIENT_SECRET, { sha256: digestOf(ctx, clientSecret) }, clientId);
  }
  return Response.json({ login: account.login, user_id: account.id, client_id: clientId, client_secret: clientSecret });
}

/** POST /_twin/accounts: an account as Twitch's sign-up page makes it. */
export async function accounts(ctx: HandlerContext): Promise<Response> {
  const account = await signUp(ctx, (ctx.body ?? {}) as Row, 'accounts');
  if (account instanceof Response) return account;
  return Response.json(userView(account, false), { status: 201 });
}

/** POST /_twin/audience: how many people are watching a channel's live stream, its viewer count. */
// source: spec:/components/schemas/GetStreamsResponseData/properties/viewer_count/description "The number of users watching the stream."
export async function audience(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row;
  const user = userByLogin(ctx, String(body.login ?? ''));
  const viewers = Number(body.viewers);
  if (!user) return refuse(404, 'no such channel');
  if (!Number.isInteger(viewers) || viewers < 0) return refuse(400, 'viewers: a whole number of people');
  const stream = liveStreamOf(ctx, String(user.id));
  if (!stream) return refuse(409, `${String(user.login)} is not live`);
  await ctx.write('GetStreamsResponseData', String(stream.id), { viewer_count: viewers }, 'audience');
  return Response.json({ login: user.login, viewer_count: viewers });
}
