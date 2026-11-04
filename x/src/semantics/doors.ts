// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"): what the World states about X
// that no API call of X's makes, each answering only its own path under `/_twin/` (the OAuth 2.0 authorize screen's
// decision post is the screen's own: ../screens/oauth2-authorize.tsx). None is vendor surface.
//
//   POST /_twin/clients {client_id?, client_secret?, name?, client_type?: 'confidential'|'public', redirect_uris?,
//                        plan?: 'self-serve'|'enterprise'}
//                                   an OAuth 2.0 App, as X's developer console makes it (no API does). A confidential
//                                   App's secret is kept by its SHA-256 (`_client_secret`); the answer carries it once.
//                                   `plan` is the developer plan the App is on (self-serve unless named enterprise):
//                                   an Enterprise App may quote-post and reply where nobody summoned it
//   POST /_twin/oauth1_apps {consumer_key?, consumer_secret?, name?, callback_urls?, access_level?: 'read'|'read-write',
//                            plan?: 'self-serve'|'enterprise'}
//                                   an OAuth 1.0a App (the developer console has no API)
//   POST /_twin/accounts {username, id?, name?, created_at?, description?, location?, url?, profile_image_url?,
//                         protected?, verified?, verified_type?, confirmed_email?, post_character_limit?, email?, password?}
//                                   an X account, as X's sign-up and profile pages make it (the twin builds neither).
//                                   `post_character_limit` is its X Premium long-post entitlement (280 to 25,000);
//                                   `password` (with `email`, or the `confirmed_email`) is what its person signs in at
//                                   x.com with (../screens/login.tsx), kept as the kernel's person, by its hash.
//                                   An account is its handle: posted again (a seed run again), it is updated and
//                                   keeps its id; an `id` another account, post or media holds, a handle already
//                                   another id's, or an `email` another account's person holds is refused; posted
//                                   again with another email and a password, its earlier person and their sessions go
//                                   (a handle is not changed by its id)
//   POST /_twin/tokens {token, account_id, scopes}
//                                   an OAuth 2.0 access token for an account without running the authorize leg: the
//                                   same `_access_token` the token endpoint issues, kept by its SHA-256
//   POST /_twin/posts {text, author_id, reply_to?, quote_of?}
//                                   a post someone outside the World made: on its own, a reply to a post, or a quote
//                                   of one (a post's reply and quote counts)
//   POST /_twin/engagement {post_id, account_id, action: 'like'|'repost'|'bookmark'} or {post_id, impressions}
//                                   the audience at work on a post: an account's like, repost or bookmark (once each),
//                                   or views added to its impressions — what a post's public metrics and its liking
//                                   users count (X's like and bookmark endpoints are called by no application here)
//   POST /_twin/rate_limit {armed?, reset?, limit?}
//                                   arms X's 15-minute-window refusal (429, legacy code 88) for every /2 request until
//                                   disarmed, so an integration can rehearse it without waiting out a window
//   POST /_twin/rate_windows {account_id, used}
//                                   sets an account's GET /2/users/me window at `used` spends, so an integration can
//                                   rehearse that endpoint's own 429 without 75 real reads
//   POST /_twin/app-credentials {username?, name?}
//                                   the World application's App, as the developer console's Apps section shows it to
//                                   the developer who owns it (the descriptor's credentialDoor): its API Key and Secret,
//                                   the owner's personal Access Token and Secret (OAuth 1.0a User Context, read and
//                                   write), and its OAuth 2.0 Client ID and Secret (confidential). The owner's account
//                                   (`username`, world_developer unless named) and the App are made on the first ask and
//                                   answered again after, writing nothing
//
// A `:` in a caller-supplied client or consumer id is refused: it is the grant-id separator (`clientId:sub`), so it
// could forge a composite collision (client `A:B` + sub `C` vs client `A` + sub `B:C`). An account's id is a numeric
// snowflake, which holds none.
import { type HandlerContext, personOf, recordPerson, sha256 } from '@volter/world-core';
import { adjustPostMetrics, alnum, CLIENT_SECRET, emptyPublicMetrics, CREDENTIAL, credentialSalt, DEFAULT_POST_CHARACTER_LIMIT, defaultRedirectUris, findAccount, findPost, invalidRequestProblem, listMediaIds, MAX_POST_CHARACTER_LIMIT, mintClientId, mintSnowflakeId, oauthError, ok, originOf, parseScopeParam, payloadOf, putRev, type Resource, type Row, rowsFor, send, tree, type XResponse } from './shared.ts';

/** A door's JSON body, or null when it is not one (an empty body is not). */
function jsonOf(ctx: HandlerContext): Record<string, unknown> | null {
  try { const parsed = JSON.parse(ctx.text) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return notJson(); }
}

/** A door body that does not parse as JSON. */
function notJson(): null {
  return null;
}

/** A door's refusal of what it was asked to seed: the invalid-request problem naming the field. */
function seedRefused(field: string, value: string, message: string): XResponse {
  return invalidRequestProblem({ [field]: [value] }, message);
}

/** One subject written by a door, its `rev` counted in the same decision, answered as the stored row. */
async function save(ctx: HandlerContext, type: string, id: string, fields: Record<string, unknown>, operation: string): Promise<Row> {
  await putRev(ctx, type, id, fields, operation);
  return ctx.row(type, id) as Row;
}

async function clientsAnswer(ctx: HandlerContext): Promise<XResponse> {
  const b = jsonOf(ctx);
  if (!b) return oauthError('invalid_request', 'A JSON body is required.', 400);
  if (typeof b['client_id'] === 'string' && b['client_id'].includes(':')) return oauthError('invalid_request', 'client_id must not contain ":".', 400);
  const clientId = typeof b['client_id'] === 'string' && b['client_id'] ? b['client_id'] : mintClientId(`oauth_client:${ctx.occurredAt}:${rowsFor(ctx)('oauth_client').length}`);
  const clientType = b['client_type'] === 'public' ? 'public' : 'confidential';
  const secret = clientType === 'public' ? null : typeof b['client_secret'] === 'string' ? b['client_secret'] : alnum(`${await credentialSalt(ctx)}:client_secret:${clientId}`, 50);
  const row = await save(ctx, 'oauth_client', clientId, {
    name: typeof b['name'] === 'string' ? b['name'] : 'Twin App',
    clientType,
    plan: b['plan'] === 'enterprise' ? 'enterprise' : 'self-serve',
    // an App registered naming no callbacks gets NextAuth's X callback at every spelling of the origin the twin is
    // reached on (the twin's decision: the demo Apps the World seeds are registered so)
    redirectUris: Array.isArray(b['redirect_uris']) ? b['redirect_uris'] : defaultRedirectUris(originOf(ctx)),
  }, 'oauth_client.create');
  if (secret !== null) await ctx.record(CLIENT_SECRET, { sha256: sha256(secret) }, clientId);
  // the answer is this registration's, whatever a concurrent one wrote since
  return { status: 200, body: { ...row, name: typeof b['name'] === 'string' ? b['name'] : 'Twin App', clientType, redirectUris: Array.isArray(b['redirect_uris']) ? b['redirect_uris'] : defaultRedirectUris(originOf(ctx)), secret } };
}

async function rateWindowsAnswer(ctx: HandlerContext): Promise<XResponse> {
  const b = jsonOf(ctx);
  if (!b || typeof b['account_id'] !== 'string' || typeof b['used'] !== 'number') return oauthError('invalid_request', 'account_id and used are required', 400);
  const windowStart = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  return { status: 200, body: await save(ctx, '_rate_window', `users_me:${b['account_id']}`, { windowStart, used: b['used'] }, 'rate_window.arm') };
}

async function oauth1AppsAnswer(ctx: HandlerContext): Promise<XResponse> {
  const b = jsonOf(ctx);
  if (!b) return oauthError('invalid_request', 'A JSON body is required.', 400);
  const held = ctx.rowsRaw('oauth1_app', { withDeleted: true }).length;
  const key = typeof b['consumer_key'] === 'string' && b['consumer_key'] ? b['consumer_key'] : alnum(`oauth1_app:${ctx.occurredAt}:${held}`, 25);
  if (key.includes(':')) return oauthError('invalid_request', 'consumer_key must not contain ":".', 400);
  const row = await save(ctx, 'oauth1_app', key, {
    name: typeof b['name'] === 'string' ? b['name'] : 'Twin App',
    secret: typeof b['consumer_secret'] === 'string' && b['consumer_secret'] ? b['consumer_secret'] : alnum(`${await credentialSalt(ctx)}:oauth1_app_secret:${ctx.occurredAt}:${held}:${key}`, 50),
    callbackUrls: Array.isArray(b['callback_urls']) ? (b['callback_urls'] as unknown[]).map(String) : [],
    accessLevel: b['access_level'] === 'read' ? 'read' : 'read-write',
    plan: b['plan'] === 'enterprise' ? 'enterprise' : 'self-serve',
  }, 'oauth1_app.create');
  return { status: 200, body: { consumer_key: key, consumer_secret: row.secret, name: row.name, callback_urls: row.callbackUrls, access_level: row.accessLevel } };
}

export async function clients(ctx: HandlerContext): Promise<Response> {
  return send(await clientsAnswer(ctx));
}

export async function rateWindows(ctx: HandlerContext): Promise<Response> {
  return send(await rateWindowsAnswer(ctx));
}

export async function oauth1Apps(ctx: HandlerContext): Promise<Response> {
  return send(await oauth1AppsAnswer(ctx));
}

// ── an account, a token, a post, a follow and the armed refusal ─────────────────────────────────

async function accountsAnswer(ctx: HandlerContext): Promise<XResponse> {
  const payload = payloadOf(ctx);
  const all = tree(ctx);
  const username = payload.username;
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(username)) return seedRefused('username', String(username ?? ''), 'A twin account requires an X-shaped username (1-15 of A-Z a-z 0-9 _).');
  // the X Premium long-post entitlement, seeded rather than assumed; out of range is a refusal, so a World cannot
  // quietly hand an account a limit X does not offer
  const declaredLimit = payload.post_character_limit;
  if (declaredLimit !== undefined
    && (typeof declaredLimit !== 'number' || !Number.isInteger(declaredLimit) || declaredLimit < DEFAULT_POST_CHARACTER_LIMIT || declaredLimit > MAX_POST_CHARACTER_LIMIT)) return seedRefused('post_character_limit', String(declaredLimit), `A seeded post_character_limit must be an integer between ${DEFAULT_POST_CHARACTER_LIMIT} and ${MAX_POST_CHARACTER_LIMIT}.`);
  // an explicit id must be an X-shaped numeric snowflake: every read orders and joins on `BigInt(id)`
  if (payload.id !== undefined && (typeof payload.id !== 'string' || !/^\d+$/.test(payload.id.trim()))) return seedRefused('id', String(payload.id), 'A seeded account id must be an X-shaped numeric snowflake.');
  // an account is its handle: the account a handle already names is this one again (a seed run again updates it and
  // keeps its id); an explicit id is its own, held by no other account, post or media (every read joins on BigInt(id))
  const named = all.find((r) => r.type === 'account' && String(r.username).toLowerCase() === username.toLowerCase());
  const explicit = typeof payload.id === 'string' && payload.id.trim() !== '' ? payload.id.trim() : undefined;
  if (explicit !== undefined) {
    const wanted = String(BigInt(explicit));
    if (named && String(BigInt(String(named.id))) !== wanted) return seedRefused('id', wanted, `A seeded account's handle is its own: @${String(named.username)} is ${String(named.id)}.`);
    const holder = [...all, ...listMediaIds(ctx).map((m) => ({ id: m, type: 'media' }))]
      .find((r) => r !== named && /^\d+$/.test(String(r.id)) && String(BigInt(String(r.id))) === wanted);
    if (holder) return idHeld(holder, wanted);
  }
  const id = explicit !== undefined ? String(BigInt(explicit)) : named ? String(named.id) : mintSnowflakeId(ctx, 'User');
  const name = typeof payload.name === 'string' ? payload.name : username;
  // the profile an X account carries and `user.fields` serves back
  const profile: Record<string, unknown> = {};
  for (const key of ['description', 'location', 'url'] as const) {
    if (payload[key] === undefined) continue;
    if (typeof payload[key] !== 'string') return invalidRequestProblem({ [key]: [String(payload[key])] }, `A seeded account's \`${key}\` must be a string.`);
    profile[key] = payload[key];
  }
  // a photo the person uploaded: X serves it from pbs.twimg.com/profile_images/…, an https URL
  const imageRefused = payload.profile_image_url === undefined ? undefined : seedProfileImage(profile, payload.profile_image_url);
  if (imageRefused) return imageRefused;
  for (const key of ['verified_type', 'confirmed_email'] as const) {
    if (payload[key] === undefined) continue;
    if (typeof payload[key] !== 'string') return invalidRequestProblem({ [key]: [String(payload[key])] }, `A seeded account's \`${key}\` must be a string.`);
    profile[key] = payload[key];
  }
  for (const key of ['protected', 'verified'] as const) {
    if (payload[key] === undefined) continue;
    if (typeof payload[key] !== 'boolean') return invalidRequestProblem({ [key]: [String(payload[key])] }, `A seeded account's \`${key}\` must be a boolean.`);
    profile[key] = payload[key];
  }
  const limit = declaredLimit !== undefined ? { post_character_limit: declaredLimit } : {};
  // the person who signs in to it at x.com: their email and password, the password kept by its hash
  const password = payload.password;
  const email = typeof payload.email === 'string' ? payload.email : profile.confirmed_email;
  if (password !== undefined && (typeof password !== 'string' || password === '' || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email))) return seedRefused('password', '(withheld)', "A seeded account's `password` must be a non-empty string, with the `email` (or `confirmed_email`) its person signs in with.");
  // a person signs in to one account: an email another account's person holds is refused, never moved (a World whose
  // seed already moved one, before this door refused it, is put right by a reset, not by seeding again)
  const held = typeof email === 'string' && password !== undefined ? personOf(ctx, email) : undefined;
  if (held && typeof held.account_id === 'string' && held.account_id !== id) return seedRefused('email', '(withheld)', "A seeded account's `email` is its own person's: another account's person signs in with it.");
  // posted again, an account keeps when it was made, and its person is the one it now names: an earlier email's goes
  await ctx.write('account', id, { username, _username: username.toLowerCase(), name, created_at: named?.created_at ?? ctx.occurredAt, ...profile, ...limit }, 'x.twin.seed_account');
  if (typeof password === 'string' && typeof email === 'string') {
    // a retired person's sessions end with them: world-ui finds a session's person by email, so one left open would
    // sign its browser in to whichever account that email names next
    for (const p of ctx.rowsRaw('_person')) if (p.account_id === id && String(p.email) !== email.trim().toLowerCase()) await retirePerson(ctx, String(p.email));
    await recordPerson(ctx, email, password, { account_id: id });
  }
  return ok({ data: { id, username, name, ...profile, ...limit } });
}

/** An explicit id another subject holds. */
function idHeld(holder: { id?: unknown; type?: unknown }, wanted: string): XResponse {
  const what = holder.type === 'account' ? `@${String((holder as Resource).username)} holds it (a handle is not changed by its id)` : holder.type === 'media' ? 'a media upload holds it' : `a ${String(holder.type)} holds it`;
  return seedRefused('id', wanted, `A seeded account id must be its own: ${what}.`);
}

/** A photo the person uploaded: X serves it from pbs.twimg.com/profile_images/…, an https URL. */
function seedProfileImage(profile: Record<string, unknown>, url: unknown): XResponse | undefined {
  if (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url)) return seedRefused('profile_image_url', String(url), "A seeded account's `profile_image_url` must be an https URL.");
  profile.profile_image_url = url;
  return undefined;
}

/** An account's earlier person, retired when it is seeded again with another email: their sessions end with them. */
async function retirePerson(ctx: HandlerContext, email: string): Promise<void> {
  for (const w of ctx.rowsRaw('_web_session')) if (String(w.email).toLowerCase() === email) await ctx.remove('_web_session', `websession:${String(w.token)}`, 'x.twin.end_session');
  await ctx.remove('_person', `person:${email}`, 'x.twin.retire_person');
}

async function tokensAnswer(ctx: HandlerContext): Promise<XResponse> {
  const payload = payloadOf(ctx);
  const token = payload.token;
  const accountId = payload.account_id;
  if (typeof token !== 'string' || token.trim() === '') return invalidRequestProblem({ token: [String(token ?? '')] }, 'A twin token requires a non-empty `token`.');
  if (typeof accountId !== 'string' || findAccount(tree(ctx), accountId) === undefined) {
    return invalidRequestProblem({ account_id: [String(accountId ?? '')] }, 'A twin token must name an account seeded through /_twin/accounts.');
  }
  const scopes = Array.isArray(payload.scopes) ? payload.scopes.map(String) : parseScopeParam(typeof payload.scopes === 'string' ? payload.scopes : '');
  // the access token the authorization server issues (./oauth2.ts `issue`), kept by its SHA-256 as bookkeeping: the
  // token itself never rides an entry. A World's token has no client and does not expire
  await ctx.record(CREDENTIAL.access.type, { sub: accountId, scope: scopes.join(' '), revoked: false, rev: 1 }, sha256(token));
  return ok({ data: { token, account_id: accountId, scopes } });
}

async function postsAnswer(ctx: HandlerContext): Promise<XResponse> {
  const payload = payloadOf(ctx);
  const all = tree(ctx);
  const text = payload.text;
  const authorId = payload.author_id;
  if (typeof text !== 'string' || text.trim() === '') return invalidRequestProblem({ text: [String(text ?? '')] }, 'A seeded post requires `text`.');
  if (typeof authorId !== 'string' || findAccount(all, authorId) === undefined) return seedRefused('author_id', String(authorId ?? ''), 'A seeded post must name an account seeded through /_twin/accounts.');
  const referenced: Array<{ type: string; id: string }> = [];
  let conversation: string | undefined;
  let inReplyTo: string | undefined;
  for (const [field, kind] of [['reply_to', 'replied_to'], ['quote_of', 'quoted']] as const) {
    const target = payload[field];
    if (target === undefined) continue;
    const post = typeof target === 'string' ? findPost(all, target) : undefined;
    if (!post) return invalidRequestProblem({ [field]: [String(target)] }, `A seeded post's \`${field}\` must name a post the World holds.`);
    referenced.push({ type: kind, id: String(post.id) });
    if (kind === 'replied_to') { conversation = String(post.conversation_id ?? post.id); inReplyTo = String(post.author_id); }
  }
  const id = mintSnowflakeId(ctx);
  for (const reference of referenced) await adjustPostMetrics(ctx, reference.id, { [reference.type === 'replied_to' ? 'reply_count' : 'quote_count']: 1 });
  await ctx.write('post', id, {
    text, author_id: authorId, created_at: ctx.occurredAt, conversation_id: conversation ?? id, edit_history_tweet_ids: [id], public_metrics: emptyPublicMetrics(),
    ...(inReplyTo ? { in_reply_to_user_id: inReplyTo } : {}), ...(referenced.length ? { referenced_tweets: referenced } : {}), deleted: false,
  }, 'x.twin.seed_post');
  return ok({ data: { id, text, author_id: authorId } });
}

const ENGAGEMENTS = new Set(['like', 'repost', 'bookmark']);

async function engagementAnswer(ctx: HandlerContext): Promise<XResponse> {
  const payload = payloadOf(ctx);
  const all = tree(ctx);
  const postId = payload.post_id;
  const post = typeof postId === 'string' ? findPost(all, postId) : undefined;
  if (!post) return invalidRequestProblem({ post_id: [String(postId ?? '')] }, 'An engagement must name a post the World holds (`post_id`).');
  if (payload.impressions !== undefined) {
    const n = payload.impressions;
    if (!Number.isInteger(n) || n < 1) return invalidRequestProblem({ impressions: [String(n)] }, '`impressions` must be a positive whole number of views.');
    const held = all.find((r) => r.type === '_impressions' && r.id === post.id)?.count;
    const count = (typeof held === 'number' ? held : 0) + n;
    await putRev(ctx, '_impressions', String(post.id), { count }, 'x.twin.impressions');
    await adjustPostMetrics(ctx, String(post.id), { impression_count: n });
    return ok({ data: { post_id: post.id, impression_count: count } });
  }
  const action = payload.action;
  if (typeof action !== 'string' || !ENGAGEMENTS.has(action)) return invalidRequestProblem({ action: [String(action ?? '')] }, 'An engagement\'s `action` is like, repost or bookmark (or send `impressions`).');
  const accountId = payload.account_id;
  if (typeof accountId !== 'string' || findAccount(all, accountId) === undefined) return seedRefused('account_id', String(accountId ?? ''), 'An engagement must name an account seeded through /_twin/accounts (`account_id`).');
  const key = `${accountId}:${String(post.id)}`;
  if (!all.some((r) => r.type === action && r.id === key && r.deleted !== true)) {
    await putRev(ctx, action, key, { user_id: accountId, tweet_id: String(post.id), created_at: ctx.occurredAt, deleted: false }, `x.twin.${action}`);
    await adjustPostMetrics(ctx, String(post.id), { [{ like: 'like_count', repost: 'retweet_count', bookmark: 'bookmark_count' }[action]!]: 1 });
  }
  return ok({ data: { post_id: post.id, account_id: accountId, action } });
}

async function rateLimitAnswer(ctx: HandlerContext): Promise<XResponse> {
  const payload = payloadOf(ctx);
  const reset = typeof payload.reset === 'number' ? payload.reset : 900;
  await ctx.write('rate_limit', 'armed', { armed: payload.armed !== false, reset, limit: typeof payload.limit === 'number' ? payload.limit : 200 }, 'x.twin.arm_rate_limit');
  return ok({ data: { armed: payload.armed !== false, reset } });
}

/** The developer account is the first member's public X identity; deployments own Apps and user grants. */
async function appCredentialsAnswer(ctx: HandlerContext): Promise<XResponse> {
  const body = jsonOf(ctx) ?? {};
  const account = await ctx.tenant('User', async (world) => {
    const email = world.members[0]!.toLowerCase();
    const existing = ofAccounts(ctx).find((row) => row.confirmed_email === email || row._owner_email === email);
    if (existing) return String(existing.id);
    const rule = { max: 15, lower: true, allowed: /[a-z0-9_]/, separator: '_' };
    const label = typeof body.username === 'string' ? body.username : world.id === 'default' ? 'world_developer' : world.id;
    for (const suffixed of [false, true]) {
      const username = ctx.vendorName(label, rule, { suffixed, identity: world.id });
      if (ofAccounts(ctx).some((row) => String(row.username).toLowerCase() === username)) continue;
      const made = await ctx.createUnique('User', { username, _username: username, name: typeof body.name === 'string' ? body.name : world.label,
        confirmed_email: email, _owner_email: email, created_at: ctx.occurredAt }, 'x.twin.seed_account');
      if (made.created || ctx.row('User', String(made.row.id))?._owner_email === email) return String(made.row.id);
    }
    throw send(oauthError('invalid_request', `A username already exists for ${world.id}.`, 400));
  });
  const userId = String(account.id);
  const app = await ctx.deploymentObject(`developer-app:${userId}`, 'oauth1_app', async (deployment) =>
    String((await ctx.create('oauth1_app', { name: deployment || 'World App', owner: userId,
      callbackUrls: [], accessLevel: 'read-write', plan: 'self-serve' }, 'oauth1_app.create')).id));
  const consumerSecret = await ctx.accountKey(`consumer-secret:${app.id}`, 'oauth1_app', {
    make: async () => {
      const issued = await ctx.issue('_credential_issue');
      await ctx.change('oauth1_app', String(app.id), (row) => {
        if (row._secretPending === true || (typeof row.secret === 'string' && (row._secret_sha256 === undefined || row._secret_sha256 === sha256(row.secret)))) return undefined;
        return { _secretLabel: `x-consumer-secret:${app.id}:${issued}`, _secretPending: true };
      }, 'oauth1_app.secret.reserve');
      const row = ctx.row('oauth1_app', String(app.id))!;
      if (row._secretPending !== true) return String(app.id);
      const secret = alnum(await ctx.secret(String(row._secretLabel)), 50);
      await ctx.change('oauth1_app', String(app.id), (current) => current._secretLabel === row._secretLabel
        ? { secret, _secret_sha256: sha256(secret), _secretPending: false } : undefined, 'oauth1_app.secret');
      return String(app.id);
    },
    read: async (row) => row.owner === userId && row.id === app.id && typeof row.secret === 'string'
      && (row._secret_sha256 === undefined || row._secret_sha256 === sha256(row.secret)) ? row.secret : undefined,
  });
  const grant = await ctx.accountKey(`oauth1-user-grant:${app.id}`, '_oauth1_token', {
    make: async () => {
      const issued = await ctx.issue('_credential_issue');
      const id = `${userId}-${alnum(`oauth1-token:${issued}`, 40)}`;
      await ctx.record('_oauth1_token', { consumerKey: app.id, userId, screenName: account.username, accessLevel: 'read-write', revoked: false }, id);
      const secret = alnum(await ctx.secret(`x-oauth1-token-secret:${id}`), 40);
      await ctx.record('_oauth1_token', { secret, _secret_sha256: sha256(secret) }, id);
      return id;
    },
    read: async (row) => row.revoked !== true && row.consumerKey === app.id && row.userId === userId && typeof row.secret === 'string'
      && (row._secret_sha256 === undefined || row._secret_sha256 === sha256(row.secret)) ? row.secret : undefined,
  });
  const client = await ctx.deploymentObject(`oauth-client:${app.id}`, 'oauth_client', async () => {
    const id = mintClientId(`oauth_client:${await ctx.issue('_credential_issue')}`);
    const made = await ctx.createUnique('oauth_client', { name: app.name, owner: userId, app_id: app.id,
      clientType: 'confidential', plan: 'self-serve', redirectUris: defaultRedirectUris(originOf(ctx)) }, 'oauth_client.create', { id });
    return String(made.row.id);
  });
  const clientSecret = await ctx.accountKey(`oauth2-client-secret:${client.id}`, CLIENT_SECRET, {
    make: async () => {
      const before = ctx.row(CLIENT_SECRET, String(client.id));
      if (before?._client === client.id && typeof before.label === 'string') {
        const value = alnum(await ctx.secret(before.label), 50);
        if (before.sha256 === sha256(value)) return String(client.id);
      }
      const issued = await ctx.issue('_credential_issue');
      const fields = { _client: client.id, label: `x-client-secret:${client.id}:${issued}`, _pending: true, deleted: false };
      const made = await ctx.createUnique(CLIENT_SECRET, fields, 'client_secret.reserve', { id: String(client.id), input: 'omit' });
      if (!made.created) await ctx.change(CLIENT_SECRET, String(client.id), (row) =>
        row._pending === true || row.label !== before?.label || row.sha256 !== before?.sha256 ? undefined : fields,
      'client_secret.reserve', { input: 'omit' });
      const row = ctx.row(CLIENT_SECRET, String(client.id))!;
      const value = alnum(await ctx.secret(String(row.label)), 50);
      await ctx.change(CLIENT_SECRET, String(client.id), (current) => current.label === row.label
        ? { sha256: sha256(value), _pending: false } : undefined, 'client_secret.issue', { input: 'omit' });
      return String(client.id);
    },
    read: async (row) => {
      if (row._client !== client.id || typeof row.label !== 'string') return undefined;
      const value = alnum(await ctx.secret(row.label), 50);
      return row.sha256 === sha256(value) ? value : undefined;
    },
  });
  return ok({ consumer_key: app.id, consumer_secret: consumerSecret.secret, access_token: grant.id, access_token_secret: grant.secret,
    client_id: client.id, client_secret: clientSecret.secret, user_id: userId, username: account.username });
}

const ofAccounts = (ctx: HandlerContext): Array<Record<string, unknown>> => ctx.rowsRaw('account').map((r) => ({ ...ctx.own(r), id: String(ctx.own(r).id ?? r.id) }));

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try { return send(await appCredentialsAnswer(ctx)); } catch (error) { if (error instanceof Response) return error; throw error; }
}

export async function accounts(ctx: HandlerContext): Promise<Response> {
  return send(await accountsAnswer(ctx));
}

export async function tokens(ctx: HandlerContext): Promise<Response> {
  return send(await tokensAnswer(ctx));
}

export async function posts(ctx: HandlerContext): Promise<Response> {
  return send(await postsAnswer(ctx));
}

export async function engagement(ctx: HandlerContext): Promise<Response> {
  return send(await engagementAnswer(ctx));
}

export async function rateLimit(ctx: HandlerContext): Promise<Response> {
  return send(await rateLimitAnswer(ctx));
}
