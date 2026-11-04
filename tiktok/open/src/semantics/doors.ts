// The World's doors: what TikTok's developer site does for the World's application's app, the accounts TikTok's people
// sign up for, their videos' audiences, and the CDN behind a placeholder image.
//
//   POST /_twin/app-credentials                   the application's apps: the developer site's client key and secret,
//                                                  and the ads portal's App ID and secret (the credential door)
//   POST /_twin/apps { redirect_uris?, url_properties? }   that app's redirect URIs and verified URL properties (Login Kit's
//                                                  settings and the URL properties widget); each list replaces the held one
//   POST /_twin/people { username, display_name, password, … }   a TikTok account
//   POST /_twin/videos/{id}/stats { view_count?, … }   a video's audience: its views, likes, comments and shares
//   GET  /_twin/media/{name}                       a placeholder image (an avatar, a cover)
//   POST /_twin/locations { location_name, … }     a location tag TikTok holds (the business lane's search finds it)
//   POST /_twin/tracks { name, artist, … }         a track of the Commercial Music Library
import type { HandlerContext } from '@volter/world-core';
import { APP, APP_SCOPES, BUSINESS_SCOPES, bodyOf, clientSecret, mediaBytes, mediaUrl, PERSON, sha256, VIDEO } from './shared.ts';

type Row = Record<string, unknown>;
const bad = (error: string): Response => Response.json({ error }, { status: 400 });

/** The World application's app of a kind: `open` (the developer site's, Login Kit and the Content Posting API) or
 *  `business` (the ads portal's, the API for Business), made the first time it is asked for. */
async function worldApp(ctx: HandlerContext, kind: 'open' | 'business'): Promise<Row> {
  const developer = await ctx.tenant('_developer', async (world) => String((await ctx.create('_developer', {
    email: world.members[0]!.toLowerCase(), name: world.label,
  }, 'developer.create')).id));
  return ctx.deploymentObject(`${kind}-application:${developer.id}`, APP, async (deployment) => {
    if (!deployment && await ctx.account() === 'default') {
      const held = ctx.rowsRaw(APP).find((row) => row.world === true && (row.kind ?? 'open') === kind && row.developer_id === undefined);
      if (held) {
        await ctx.record(APP, { developer_id: developer.id }, String(held.id));
        return String(held.id);
      }
    }
    const app = await ctx.create(APP, (id) => ({ name: deployment || 'World', kind, developer_id: developer.id,
      client_key: kind === 'open' ? `aw${ctx.crypto.digest('sha256', `tiktok-client-key:${id}`, 'hex').slice(0, 14)}`
        : String(BigInt(`0x${ctx.crypto.digest('sha256', `tiktok-app-id:${id}`, 'hex').slice(0, 15)}`)).padStart(19, '7').slice(0, 19),
      scopes: kind === 'open' ? APP_SCOPES : BUSINESS_SCOPES, redirect_uris: [], url_properties: [], created: ctx.occurredAt,
    }), 'application.create');
    return String(app.id);
  });
}

async function applicationSecret(ctx: HandlerContext, app: Row): Promise<string> {
  const key = await ctx.accountKey(`client-secret:${app.id}`, APP, {
    make: async () => {
      const held = ctx.row(APP, String(app.id))!;
      if (held._secret_sha256 !== undefined && await clientSecret(ctx, held)) return String(app.id);
      const issue = await ctx.issue('_credential_issue');
      await ctx.change(APP, String(app.id), (row) => row._secret_pending === true
        || row._secret_sha256 !== held._secret_sha256 || row._secret_label !== held._secret_label ? undefined
        : { _secret_label: held._secret_sha256 === undefined ? `tiktok-client-secret:${app.id}` : `tiktok-client-secret:${app.id}:${issue}`, _secret_pending: true }, 'application.secret.reserve');
      const native = ctx.row(APP, String(app.id))!;
      const value = ctx.crypto.digest('sha256', await ctx.secret(String(native._secret_label)), 'hex').slice(0, 32);
      await ctx.change(APP, String(app.id), (row) => row._secret_label === native._secret_label
        ? { _secret_sha256: ctx.crypto.sha256(value), _secret_pending: false } : undefined, 'application.secret');
      return String(app.id);
    },
    read: (row) => row.developer_id === app.developer_id && row.kind === app.kind ? clientSecret(ctx, row) : Promise.resolve(undefined),
  });
  return key.secret;
}

export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const app = await worldApp(ctx, 'open'), business = await worldApp(ctx, 'business');
  return Response.json({ client_key: app.client_key, client_secret: await applicationSecret(ctx, app),
    business_client_id: business.client_key, business_client_secret: await applicationSecret(ctx, business) }, { status: 201 });
}

export async function apps(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);
  const redirects = list(b.redirect_uris);
  const props = list(b.url_properties);
  const businessRedirects = list(b.business_redirect_uris);
  if (redirects?.some((u) => !/^https:\/\//.test(u))) return bad('a redirect URI must be https');
  // the ads portal's rules for a TikTok account holder redirect URL
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1738083939371009&language=ENGLISH "URLs must be absolute and end with"
  const portalRefusal = (u: string): string | undefined => {
    let url: URL;
    try { url = new URL(u); } catch { return 'must be absolute'; }
    if (url.protocol !== 'https:') return 'must start with https://';
    if (!u.endsWith('/')) return 'must end with /';
    if (url.search || url.hash) return 'cannot carry query parameters or anchors';
    if (url.port) return 'cannot include a port';
    if (u.length < 10 || u.length > 512) return 'must be 10 to 512 characters';
    return undefined;
  };
  const badBusiness = businessRedirects?.map((u) => [u, portalRefusal(u)] as const).find(([, r]) => r);
  if (badBusiness) return bad(`the business redirect URL ${badBusiness[0]} ${badBusiness[1]}`);
  if (businessRedirects && businessRedirects.length > 10) return bad('a business app holds up to 10 redirect URLs');
  const app = await worldApp(ctx, 'open');
  await ctx.record(APP, { ...app, ...(redirects ? { redirect_uris: redirects } : {}), ...(props ? { url_properties: props } : {}) }, String(app.id));
  if (businessRedirects) {
    const business = await worldApp(ctx, 'business');
    await ctx.record(APP, { ...business, redirect_uris: businessRedirects }, String(business.id));
  }
  const kept = ctx.row(APP, String(app.id))!;
  return Response.json({ client_key: kept.client_key, redirect_uris: kept.redirect_uris, url_properties: kept.url_properties, ...(businessRedirects ? { business_redirect_uris: businessRedirects } : {}) });
}

export async function people(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.username !== 'string' || !/^[a-z0-9._]{2,24}$/.test(b.username)) return bad('username is 2 to 24 lowercase letters, digits, dots and underscores');
  if (typeof b.password !== 'string' || !b.password) return bad('password is required');
  if (ctx.rowsRaw(PERSON).some((p) => p.deleted !== true && p.username === b.username)) return bad('that username is taken');
  const id = ctx.mint(PERSON);
  const n = (k: string): number => (typeof b[k] === 'number' ? Number(b[k]) : 0);
  await ctx.record(PERSON, {
    username: b.username, display_name: typeof b.display_name === 'string' ? b.display_name : b.username, password_sha256: sha256(ctx, b.password),
    bio_description: typeof b.bio_description === 'string' ? b.bio_description : '', is_verified: b.is_verified === true, private: b.private === true,
    follower_count: n('follower_count'), following_count: n('following_count'), likes_count: n('likes_count'),
    max_video_post_duration_sec: typeof b.max_video_post_duration_sec === 'number' ? b.max_video_post_duration_sec : 180, created: ctx.occurredAt,
  }, id);
  return Response.json({ username: b.username }, { status: 201 });
}

export async function videoStats(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.id ?? '');
  const v = ctx.row(VIDEO, id);
  if (!v || v.deleted === true) return Response.json({ error: 'no such video' }, { status: 404 });
  const b = bodyOf(ctx);
  const counts = Object.fromEntries(['view_count', 'like_count', 'comment_count', 'share_count'].filter((k) => typeof b[k] === 'number' && Number(b[k]) >= 0).map((k) => [k, Number(b[k])]));
  await ctx.write(VIDEO, id, counts, 'video.audience');
  return Response.json({ id, ...counts });
}

export async function media(ctx: HandlerContext): Promise<Response> {
  const name = String(ctx.call.params.name ?? '').replace(/\.png$/, '');
  return new Response(new Uint8Array(mediaBytes(name)),  { headers: { 'content-type': 'image/png' } });
}

/** POST /_twin/locations { location_name, location_address? }: a location tag TikTok holds, as its search finds it. */
export async function locations(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.location_name !== 'string' || !b.location_name) return bad('location_name is required');
  const id = ctx.mint('_location');
  await ctx.record('_location', { location_name: b.location_name, location_address: typeof b.location_address === 'string' ? b.location_address : '' }, id);
  return Response.json({ location_id: id, location_name: b.location_name }, { status: 201 });
}

/** POST /_twin/tracks { name, artist, genre?, duration? }: a track of the Commercial Music Library, with its song clip. */
export async function tracks(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.name !== 'string' || !b.name || typeof b.artist !== 'string') return bad('name and artist are required');
  const id = ctx.mint('_track');
  const clip = String(7_300_000_000_000_000_000n + BigInt(id.replace(/\D/g, '') || '0'));
  await ctx.record('_track', {
    name: b.name, artist: b.artist, genre: typeof b.genre === 'string' ? b.genre.toUpperCase() : 'POP', duration: typeof b.duration === 'number' ? b.duration : 30,
    song_clip_id: clip, thumbnail_url: mediaUrl(ctx, `track-${id}`), preview_url: mediaUrl(ctx, `track-${id}`),
  }, id);
  return Response.json({ id, song_clip_id: clip }, { status: 201 });
}
