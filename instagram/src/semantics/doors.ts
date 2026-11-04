// The World's doors (architecture, "Doors, screens and the gap"): what Instagram's own pages and people do that its API
// does not.
//
//   POST /_twin/app-credentials { account?, deployment?, redirect_uris? }   the App Dashboard: a deployment app and
//        its long-lived grant from the organization's first member's professional account
//   POST /_twin/accounts { username, password, account_type?, ... }  an Instagram account, as instagram.com's sign-up
//        makes it (and its switch to a professional account)
//   POST /_twin/media/{id}/audience { views?, reach?, likes?, saved?, shares?, comment? }   the audience at work on a
//        media: Instagram's people watching, liking, saving, sharing and commenting in the app, which no API call does
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, APP, COMMENT, MEDIA, PERMISSIONS, TOKEN, accountByName, appScopedId, appSecret, flagOf, igTime, igsid, issueToken, obj, seconds, sha256, text, tokenValue, type Row } from './shared.ts';

const bad = (error: string, status = 400): Response => Response.json({ error }, { status });
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
const ACCOUNT_TYPES = ['Business', 'Media_Creator', 'Personal'];

/** An account's fields from a door's body. */
function accountFields(b: Row): Row | string {
  const username = text(b.username)?.toLowerCase();
  if (!username || /\s/.test(username)) return 'username is required, without spaces';
  const type = text(b.account_type) ?? 'Business';
  if (!ACCOUNT_TYPES.includes(type)) return `account_type is one of ${ACCOUNT_TYPES.join(', ')}`;
  return {
    username, name: text(b.name) ?? username, account_type: type, biography: text(b.biography) ?? '', website: text(b.website) ?? '',
    followers_count: count(b.followers_count) ?? 0, follows_count: count(b.follows_count) ?? 0,
  };
}

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started "Access tokens from the App Dashboard are long-lived and are valid for 60 days."
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const b = obj(ctx.body);
    const uris = b.redirect_uris === undefined ? undefined : Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (uris && !uris.every((uri) => { try { return ['https:', 'http:'].includes(new URL(uri).protocol); } catch { return false; } })) return bad('each redirect URI is an absolute http(s) URL');
    const account = await ctx.tenant(ACCOUNT, async (organization) => {
      const email = organization.members[0]!.toLowerCase();
      const existing = ctx.rowsRaw(ACCOUNT).find((row) => row._email === email);
      if (existing) return String(existing.id);
      const rule = { max: 30, lower: true, allowed: /[a-z0-9._]/, separator: '_', first: /[a-z0-9_]/ };
      const create = (suffixed: boolean) => {
        const fields = accountFields({ username: ctx.vendorName(organization.id, rule, { suffixed, identity: organization.id }), name: organization.label, ...b });
        if (typeof fields === 'string') throw bad(fields);
        return makeAccount(ctx, { ...fields, _email: email, ...(text(b.password) ? { password_sha256: sha256(ctx, String(b.password)) } : {}) });
      };
      let made = await create(false);
      if (made instanceof Response) made = await create(true);
      if (made instanceof Response) throw bad(`that username is taken (${organization.id})`, 409);
      return String(made.id);
    });
    if (account.account_type === 'Personal') return bad('the App Dashboard generates tokens for professional accounts');
    const app = await ctx.deploymentObject(`developer-app:${String(account.id)}`, APP, async (deployment) => {
      const made = await ctx.create(APP, (id) => ({ name: deployment || 'World', app_id: id, redirect_uris: uris ?? [], _developer_account: account.id, created: ctx.occurredAt }), 'application.create');
      return String(made.id);
    });
    if (uris) await ctx.record(APP, { redirect_uris: uris }, String(app.id));
    const secret = await ctx.accountKey('app-secret', APP, {
      make: async () => {
        const before = ctx.row(APP, String(app.id))!;
        const serial = await ctx.issue('_credential_serial');
        await ctx.change(APP, String(app.id), (row) => row._developer_account === account.id && row._secret_pending !== true && row._secret_label === before._secret_label && row.secret_sha256 === before.secret_sha256
          ? { _secret_label: `instagram-app-secret:${serial}`, _secret_pending: true } : undefined, 'application.secret.reserve', { input: 'omit' });
        const selected = ctx.row(APP, String(app.id))!;
        const value = await appSecret(ctx, selected);
        await ctx.change(APP, String(app.id), (row) => row._developer_account === account.id && row._secret_label === selected._secret_label
          ? { secret_sha256: sha256(ctx, value), _secret_pending: false } : undefined, 'application.secret.issue', { input: 'omit' });
        return String(app.id);
      },
      read: async (row) => {
        if (row.id !== app.id || row._developer_account !== account.id || row._secret_pending === true) return undefined;
        const value = await appSecret(ctx, row);
        return sha256(ctx, value) === row.secret_sha256 ? value : undefined;
      },
    });
    const token = await ctx.accountKey('user-grant', TOKEN, {
      make: async () => (await issueToken(ctx, { app: String(app.id), account: String(account.id), permissions: PERMISSIONS, kind: 'long', source: 'app-dashboard' })).id,
      read: async (row) => {
        if (row.app !== app.id || row.account !== account.id || Number(row.expires_at) <= seconds(ctx.occurredAt)) return undefined;
        const value = await tokenValue(ctx, String(row.id));
        return sha256(ctx, value) === row.sha256 ? value : undefined;
      },
    });
    return Response.json({ app_id: app.app_id, app_secret: secret.secret, redirect_uris: uris ?? app.redirect_uris, access_token: token.secret, user_id: String(account.id), id: appScopedId(ctx, app, account), username: account.username }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}

async function makeAccount(ctx: HandlerContext, fields: Row): Promise<Row | Response> {
  const made = await ctx.createUnique(ACCOUNT, { ...fields, created: ctx.occurredAt }, 'account.create');
  return made.created ? ctx.row(ACCOUNT, String(made.row.id))! : bad('that username is taken', 409);
}

export async function accounts(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const fields = accountFields(b);
  if (typeof fields === 'string') return bad(fields);
  if (!text(b.password)) return bad('password is required');
  if (accountByName(ctx, fields.username)) return bad('that username is taken');
  const made = await makeAccount(ctx, { ...fields, password_sha256: sha256(ctx, String(b.password)) });
  return made instanceof Response ? made : Response.json({ id: made.id, username: fields.username, account_type: fields.account_type }, { status: 201 });
}

export async function audience(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.id ?? '');
  const media = ctx.row(MEDIA, id);
  if (!media || media.deleted === true) return bad('no such media', 404);
  const b = obj(ctx.body);
  const moved: Row = {};
  const add = (field: string, given: unknown): string | undefined => {
    if (given === undefined) return undefined;
    const n = count(given);
    if (n === undefined) return `${field} is a count to add: a whole number, 0 or more`;
    moved[field] = Number(media[field] ?? 0) + n;
    return undefined;
  };
  const refused = add('_views', b.views) ?? add('_reach', b.reach) ?? add('like_count', b.likes) ?? add('_saved', b.saved) ?? add('_shares', b.shares);
  if (refused) return bad(refused);
  let commentId: string | undefined;
  if (b.comment !== undefined) {
    const c = obj(b.comment);
    const username = text(c.username)?.toLowerCase();
    const said = text(c.text);
    if (!username || !said) return bad('a comment names its username and its text');
    // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "Set to true to enable comments or false to disable comments."
    if (flagOf(media.is_comment_enabled) === false) return bad('comments are turned off on this media', 403);
    const parent = text(c.parent_id);
    const top = parent ? ctx.row(COMMENT, parent) : undefined;
    if (parent && (!top || top.deleted === true || obj(top.media).id !== id)) return bad('parent_id names no comment on this media');
    commentId = ctx.mint(COMMENT);
    const owner = String(media._account);
    await ctx.write(COMMENT, commentId, {
      id: commentId, text: said, timestamp: igTime(ctx.occurredAt), from: { id: igsid(ctx, owner, username), username }, username,
      hidden: false, like_count: 0, media: { id, media_product_type: media.media_product_type },
      ...(top ? { parent_id: typeof top.parent_id === 'string' ? top.parent_id : String(top.id) } : {}), _account: media._account, _media: id,
    }, 'comment.audience');
  }
  if (Object.keys(moved).length) await ctx.write(MEDIA, id, moved, 'media.audience');
  const now = ctx.row(MEDIA, id)!;
  return Response.json({
    id, views: Number(now._views ?? 0), reach: Number(now._reach ?? 0), like_count: Number(now.like_count ?? 0), saved: Number(now._saved ?? 0), shares: Number(now._shares ?? 0),
    ...(commentId ? { comment_id: commentId } : {}),
  });
}
