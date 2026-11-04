import type { HandlerContext } from '@volter/world-core';
import { FIELD_SCOPE, VIDEO, authorized, mediaUrl, ok, openIdOf, refuse, type Row, unionIdOf } from './shared.ts';

// source: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info "endpoint returns some basic information for a given TikTok user."
export async function userInfo(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  const fields = String(new URL(ctx.call.request.url).searchParams.get('fields') ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  const unknown = fields.filter((f) => !(f in FIELD_SCOPE));
  if (!fields.length || unknown.length) return refuse(ctx, 400, 'invalid_params', `Invalid fields: ${unknown.join(',') || '(none)'}`);
  const missing = [...new Set(fields.map((f) => FIELD_SCOPE[f]!))].filter((s) => !c.scopes.includes(s));
  if (missing.length) return refuse(ctx, 401, 'scope_not_authorized', `The user did not authorize the scope required for completing this request (${missing.join(',')}).`);
  const p = c.person;
  // "The total number of publicly posted videos by the user": the person's public videos, counted from the set
  const videos = ctx.rowsRaw(VIDEO).filter((v) => v.deleted !== true && v._person === p.id && v._public === true).length;
  const avatar = mediaUrl(ctx, `avatar-${String(p.id)}`);
  const all: Row = {
    open_id: openIdOf(ctx, c.app, p), union_id: unionIdOf(ctx, p), avatar_url: avatar, avatar_url_100: avatar, avatar_large_url: avatar, display_name: p.display_name,
    bio_description: p.bio_description ?? '', profile_deep_link: `https://www.tiktok.com/@${String(p.username)}`, is_verified: p.is_verified === true, username: p.username,
    follower_count: Number(p.follower_count ?? 0), following_count: Number(p.following_count ?? 0), likes_count: Number(p.likes_count ?? 0), video_count: videos,
  };
  return ok(ctx, { user: Object.fromEntries(fields.map((f) => [f, all[f]])) });
}
