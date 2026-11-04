// The World's doors (twin-world's architecture, "Doors, screens and the gap"): what reddit.com's pages do that its API
// does not, and the World's own facts, each answering only its own path under `/_twin/`. None is vendor surface.
//
//   POST /_twin/accounts {username, email, password, created?}
//         a Reddit account, as reddit.com's sign-up page makes it: its username, the email it signs in with, its password
//         (kept by its hash, as a person the sign-in page knows), and its own profile community (u_<name>)
//   POST /_twin/apps {owner, name, type: script|web|installed, redirect_uri?, description?}
//         an app on reddit.com/prefs/apps: its client id, and a script or web app's secret, shown once
//   POST /_twin/subreddits {name, title, owner, public_description?, type?, link_type?, created?}
//         a community as reddit.com's Create a community page makes it, for a seed: a seed call carries no token, so it
//         cannot call POST /api/site_admin, which a life calls
//   POST /_twin/app-credentials {username}
//         the World application's bearer token for the World's account (the descriptor's credentialDoor), the same at
//         every boot: it stands in for the token the World's operator mints with the script app's password grant before
//         a send, holds every scope, and is not held to a token's day of life, since the World's application keeps it
//         across the days a dry run spans
import type { HandlerContext } from '@volter/world-core';
import { recordPerson } from '@volter/world-core';
import { accountNamed, ACCOUNT, APP, CLIENT_SECRET, httpError, MEMBERSHIP, nowSeconds, SUBREDDIT, subredditNamed, TOKEN, type Row } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : {});
const bad = (message: string): Response => Response.json({ message, error: 400 }, { status: 400 });

/** A username Reddit takes: 3 to 20 letters, digits, `_` or `-`.
 *  Where the documentation stops: Reddit's sign-up page states the rule; no API reaches it, and the twin holds a door's
 *  username to it. */
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

export async function accounts(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const username = String(b.username ?? '');
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  if (!USERNAME.test(username)) return bad('username is 3 to 20 letters, digits, _ or -');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return bad('an email is required');
  if (password.length < 8) return bad('a password of at least 8 characters is required');
  if (accountNamed(ctx, username)) return Response.json({ message: 'that username is already taken', error: 409 }, { status: 409 });
  const id = ctx.mint(ACCOUNT);
  const created = typeof b.created === 'string' ? Math.floor(Date.parse(b.created) / 1000) : nowSeconds(ctx);
  await recordPerson(ctx, email, password, { username });
  // an account's own profile community, u_<name>, is made with it (GET /api/v1/me answers it as `subreddit`)
  const profile = ctx.mint(SUBREDDIT);
  await ctx.write(SUBREDDIT, profile, { id: profile, display_name: `u_${username}`, title: '', subreddit_type: 'user', submission_type: 'any', public_description: '', description: '', created_utc: created, _profile_of: id }, 'subreddit.create');
  await ctx.write(ACCOUNT, id, { id, name: username, _name: username.toLowerCase(), created_utc: created, _email: email, _profile: profile }, 'account.create');
  return Response.json({ id, name: username, email }, { status: 201 });
}

export async function apps(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const owner = accountNamed(ctx, String(b.owner ?? ''));
  if (!owner) return bad('owner names no account');
  const type = String(b.type ?? 'script');
  if (!['script', 'web', 'installed'].includes(type)) return bad('type is script, web or installed');
  if (typeof b.name !== 'string' || !b.name.trim()) return bad('a name is required');
  const clientId = ctx.mint(APP);
  await ctx.write(APP, clientId, { client_id: clientId, name: b.name, app_type: type, description: b.description ?? '', redirect_uri: b.redirect_uri ?? null, developers: [String(owner.id)], created_utc: nowSeconds(ctx) }, 'app.create');
  // an installed app keeps no secret (the OAuth2 wiki: "Cannot keep a secret, and therefore, does not receive one")
  let secret: string | null = null;
  if (type !== 'installed') {
    secret = (await ctx.secret(`client-secret:${clientId}`)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
    await ctx.record(CLIENT_SECRET, { sha256: ctx.crypto.sha256(secret) }, clientId);
  }
  return Response.json({ client_id: clientId, client_secret: secret, name: b.name, type }, { status: 201 });
}

export async function subreddits(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const owner = accountNamed(ctx, String(b.owner ?? ''));
  if (!owner) return bad('owner names no account');
  const name = String(b.name ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_]{2,20}$/.test(name)) return bad("that name isn't going to work");
  if (subredditNamed(ctx, name)) return Response.json({ message: 'that subreddit already exists', error: 409 }, { status: 409 });
  const id = ctx.mint(SUBREDDIT);
  const created = typeof b.created === 'string' ? Math.floor(Date.parse(b.created) / 1000) : nowSeconds(ctx);
  await ctx.write(SUBREDDIT, id, {
    id, display_name: name, title: String(b.title ?? name), public_description: String(b.public_description ?? ''), description: String(b.description ?? ''),
    subreddit_type: String(b.type ?? 'public'), submission_type: String(b.link_type ?? 'any'), lang: 'en', allow_images: true, allow_videos: true, wiki_enabled: false, over18: false, created_utc: created,
  }, 'subreddit.create');
  await ctx.write(MEMBERSHIP, `${id}:${String(owner.id)}`, { subreddit: id, user: owner.id, moderator: true, subscriber: true }, 'membership.create');
  return Response.json({ id, name: `t5_${id}`, display_name: name }, { status: 201 });
}

/** The first member's shared Reddit identity, without manufacturing a sign-in password. */
async function memberAccount(ctx: HandlerContext): Promise<Row> {
  const account = await ctx.tenant(ACCOUNT, async (world) => {
    const email = world.members[0]!.toLowerCase();
    const held = ctx.rowsRaw(ACCOUNT).find((row) => row._email === email);
    if (held) return String(held.id);
    const label = world.id.length < 3 ? `world-${world.id}` : world.id;
    for (const suffixed of [false, true]) {
      const name = ctx.vendorName(label, { max: 20, allowed: /[A-Za-z0-9_-]/ }, { suffixed, identity: world.id });
      const made = await ctx.createUnique(ACCOUNT, (id) => ({ id, name, _name: name.toLowerCase(), _email: email,
        created_utc: nowSeconds(ctx) }), 'account.create');
      const row = ctx.row(ACCOUNT, String(made.row.id))!;
      if (made.created || row._email === email) return String(row.id);
    }
    throw Response.json({ message: `A username already exists for ${world.id}.`, error: 409 }, { status: 409 });
  });
  if (!account._profile || !ctx.row(SUBREDDIT, String(account._profile))) {
    const made = await ctx.createUnique(SUBREDDIT, (id) => ({ id, display_name: `u_${account.name}`, title: '',
      subreddit_type: 'user', submission_type: 'any', public_description: '', description: '',
      created_utc: account.created_utc, _profile_of: account.id }), 'subreddit.create');
    await ctx.change(ACCOUNT, String(account.id), (row) => row._profile === made.row.id ? undefined : { _profile: made.row.id }, 'account.profile');
  }
  return ctx.row(ACCOUNT, String(account.id))!;
}

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const body = bodyOf(ctx);
    const direct = body.account === undefined && body.deployment === undefined && typeof body.username === 'string';
    const account = direct ? accountNamed(ctx, String(body.username)) : await memberAccount(ctx);
    if (!account) return httpError(404);
    const app = await ctx.deploymentObject(`oauth-app:${account.id}`, APP, async (deployment) => {
      const made = await ctx.create(APP, (id) => ({ client_id: id, name: deployment || 'World App', app_type: 'script',
        description: '', redirect_uri: null, developers: [String(account.id)], created_utc: nowSeconds(ctx) }), 'app.create');
      const id = String(made.id);
      const secret = (await ctx.secret(`client-secret:${id}`)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
      await ctx.record(CLIENT_SECRET, { sha256: ctx.crypto.sha256(secret) }, id);
      return id;
    });
    const key = await ctx.accountKey(`oauth-grant:${app.id}`, TOKEN, {
      make: async () => {
        const id = await ctx.issue(TOKEN);
        const label = `reddit-app-token:${app.id}:${id}`;
        const value = (await ctx.secret(label)).replace(/[^A-Za-z0-9_-]/g, '');
        await ctx.record(TOKEN, { label, sha256: ctx.crypto.sha256(value), account: account.id, client: app.client_id,
          scope: '*', expires_at: null, revoked: false, issued_utc: nowSeconds(ctx) }, id);
        return id;
      },
      read: async (row) => {
        if (row.revoked === true || row.account !== account.id || row.client !== app.client_id
          || (typeof row.expires_at === 'number' && row.expires_at <= nowSeconds(ctx))) return undefined;
        const value = (await ctx.secret(String(row.label))).replace(/[^A-Za-z0-9_-]/g, '');
        return row.sha256 === ctx.crypto.sha256(value) ? value : undefined;
      },
    });
    return Response.json({ access_token: key.secret, token_type: 'bearer', scope: '*', username: account.name }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}
