// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"): what Twitch's own pages and its
// audience do that its API does not. Twitch's sign-up page (an account, its channel and its stream key) and its developer
// console (an application, its client id and secret) have no API; nor does the number of people watching a stream.
import { personOf, personWith, recordPerson, type HandlerContext } from '@volter/world-core';
import { CLIENT_SECRET, credentialString, digestOf, liveStreamOf, loginOf, STREAM_KEY, streamKeyOf, userByLogin, userView, type Row } from './shared.ts';

const refuse = (status: number, message: string): Response => Response.json({ error: message }, { status });

/** Native user/channel provisioning is shared by sign-up and metadata credential issuance. */
async function provisionUser(ctx: HandlerContext, login: string, email: string, displayName: string, door: string): Promise<Row> {
  const createdAt = ctx.occurredAt.replace(/\.\d{3}Z$/, 'Z');
  // source: spec:/components/schemas/GetUsersResponseData/properties/created_at/description "The timestamp is in RFC3339 format."
  // Where the documentation stops: an account without its own picture shows Twitch's default one, from Twitch's image
  // host; the twin names one there per account and draws its pages' avatars itself.
  const made = await ctx.createUnique('GetUsersResponseData', (id) => ({
    login, display_name: displayName, type: '', broadcaster_type: '', description: '',
    profile_image_url: `https://static-cdn.jtvnw.net/user-default-pictures-uv/${ctx.crypto.uuidFrom(`twitch-avatar:${id}`)}-profile_image-300x300.png`,
    offline_image_url: '', view_count: 0, email, created_at: createdAt, chat_color: '',
  }), door);
  if (!made.created) throw refuse(409, `${login} is taken`);
  const user = made.row, id = String(user.id);
  // every account is a channel: its information as Get Channel Information answers a channel that never streamed
  // source: spec:/components/schemas/GetChannelInformationResponseData/properties/title/description "The value is an empty string if the broadcaster has never streamed."
  // source: spec:/components/schemas/GetChannelInformationResponseData/properties/game_id/description "The value is an empty string if the broadcaster has never played a game."
  await ctx.write('GetChannelInformationResponseData', id, {
    broadcaster_id: id, broadcaster_login: login, broadcaster_name: displayName, broadcaster_language: 'en',
    game_id: '', game_name: '', title: '', delay: 0, tags: [], content_classification_labels: [], is_branded_content: false,
  }, door);
  await ctx.record(STREAM_KEY, { user_id: id }, digestOf(ctx, await streamKeyOf(ctx, id)));
  return { ...user, id };
}

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
  let user: Row;
  try { user = await provisionUser(ctx, login, email, displayName, door); }
  catch (error) { if (error instanceof Response) return error; throw error; }
  const id = String(user.id);
  await recordPerson(ctx, email, password, { user_id: id });
  return { ...user, id };
}

/** A login already taken: the account it names when the password is its own (the same door at every boot), else a
 *  refusal. */
function takenLogin(ctx: HandlerContext, taken: Row, password: string): Row | Response {
  const person = personOf(ctx, String(taken.email));
  return person && person.user_id === taken.id && personWith(ctx, String(taken.email), password) ? taken : refuse(409, `${String(taken.login)} is taken`);
}

/** The first member's Twitch identity owns the deployment's registered applications. */
async function memberUser(ctx: HandlerContext): Promise<Row> {
  return ctx.tenant('GetUsersResponseData', async (world) => {
    const email = world.members[0]!.toLowerCase();
    const existing = ctx.rowsRaw('GetUsersResponseData').find((row) => row.email === email);
    if (existing) return String(existing.id);
    const label = world.id.length < 4 ? `world_${world.id}` : world.id;
    for (const suffixed of [false, true]) {
      const login = ctx.vendorName(label, { max: 25, lower: true, allowed: /[a-z0-9_]/, separator: '_' }, { suffixed, identity: world.id });
      try { return String((await provisionUser(ctx, login, email, login, 'developerConsole')).id); }
      catch (error) { if (!(error instanceof Response) || error.status !== 409) throw error; }
    }
    throw refuse(409, `A login already exists for ${world.id}.`);
  });
}

/** POST /_twin/console: an account and an application registered in its developer console. */
export async function developerConsole(ctx: HandlerContext): Promise<Response> {
  try {
    const body = (ctx.body ?? {}) as Row;
    const direct = body.account === undefined && body.deployment === undefined;
    const account = direct ? await signUp(ctx, body, 'developerConsole') : await memberUser(ctx);
    if (account instanceof Response) return account;
    const settings = (body.application ?? {}) as Row;
    const name = ctx.deployment() || String(settings.name ?? '').trim();
    const redirects = Array.isArray(settings.redirect_uris) ? settings.redirect_uris.map(String) : [];
    if (!name) return refuse(400, 'application.name is required');
    if (!redirects.length || redirects.some((value) => !/^https?:\/\//.test(value))) return refuse(400, 'application.redirect_uris: one or more http(s) URLs');
    const app = await ctx.deploymentObject(`application:${account.id}:${name}`, 'application', async () => {
      const held = direct ? ctx.rowsRaw('application').find((row) => row.owner_id === account.id && row.name === name) : undefined;
      if (held) return String(held.id);
      return String((await ctx.create('application', (id) => ({ client_id: id, name, owner_id: account.id,
        redirect_uris: redirects, client_type: 'confidential', created_at: ctx.occurredAt }), 'developerConsole')).id);
    });
    const key = await ctx.accountKey(`client-secret:${app.id}`, CLIENT_SECRET, {
      make: async () => {
        const before = ctx.row(CLIENT_SECRET, String(app.id));
        const oldLabel = typeof before?.label === 'string' ? before.label : `client-secret:${app.id}`;
        const existing = await credentialString(ctx, oldLabel);
        if (before?.sha256 === digestOf(ctx, existing) && before.revoked !== true && before._pending !== true) {
          await ctx.record(CLIENT_SECRET, { _application: app.id, label: oldLabel }, String(app.id));
          return String(app.id);
        }
        const issue = await ctx.issue('_credential_issue');
        const reserved = { _application: app.id, label: `client-secret:${app.id}:${issue}`, _pending: true, revoked: false, deleted: false };
        if (before) {
          await ctx.change(CLIENT_SECRET, String(app.id), (row) =>
            row._pending === true || row.label !== before.label || row.sha256 !== before.sha256 ? undefined : reserved,
          'client_secret.reserve', { input: 'omit' });
        } else {
          await ctx.createUnique(CLIENT_SECRET, reserved, 'client_secret.reserve', { id: String(app.id), input: 'omit' });
        }
        const row = ctx.row(CLIENT_SECRET, String(app.id))!;
        const value = await credentialString(ctx, String(row.label));
        await ctx.change(CLIENT_SECRET, String(app.id), (current) => current.label === row.label
          ? { sha256: digestOf(ctx, value), _pending: false } : undefined, 'client_secret.issue', { input: 'omit' });
        return String(app.id);
      },
      read: async (row) => {
        if (row._application !== app.id || row.revoked === true || row._pending === true || typeof row.label !== 'string') return undefined;
        const value = await credentialString(ctx, row.label);
        return row.sha256 === digestOf(ctx, value) ? value : undefined;
      },
    });
    return Response.json({ login: account.login, user_id: account.id, client_id: app.id, client_secret: key.secret });
  } catch (error) { if (error instanceof Response) return error; throw error; }
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
