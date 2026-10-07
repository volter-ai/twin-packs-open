// CLERK'S IMAGE HOST, img.clerk.com: the avatar Clerk shows for a user or an organization with no image of its own
// ("Returns `false` if Clerk is displaying an avatar for the user", the backend User reference, `hasImage`), at the URL
// the twin gives it (../semantics/shared.ts `defaultImageUrl`: the avatar's description, base64url JSON with the subject
// and its initials).
// Where the documentation stops and the twin decides: Clerk does not document the images themselves, so an avatar is the
// subject's initials, white, centred on a colour from the subject's SHA-256, each an SVG (browsers draw an image by its type, whatever its path's extension); the same path always draws
// the same image, and an answer may be cached for a day. Any other path is 404; any method but GET and HEAD, 405.
import { gap } from '../../fapi/src/semantics/gap.ts';
import { digestBytes, type HandlerContext } from '@volter/world-core';

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function colour(seed: string): string {
  const h = digestBytes('sha256', seed);
  const hue = ((h[0]! << 8) | h[1]!) % 360;
  return `hsl(${hue} 55% 45%)`;
}

function svg(background: string, text: string, fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="${background}"/>`
    + `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="${fill}" font-family="Arial, sans-serif" font-size="52">${escape(text)}</text></svg>`;
}

/** An answer of img.clerk.com. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const method = ctx.call.request.method;
  if (method !== 'GET' && method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const headers = { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' };
  const answer = (body: string): Response => new Response(method === 'HEAD' ? null : body, { status: 200, headers });
  const segment = url.pathname.replace(/^\//, '');
  try {
    const avatar = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { type?: string; rid?: string; initials?: string };
    return avatar.type === 'default' && typeof avatar.rid === 'string'
      ? answer(svg(colour(avatar.rid), typeof avatar.initials === 'string' ? avatar.initials.slice(0, 2) : '', '#ffffff')) : malformedAvatar(ctx); } catch { return malformedAvatar(ctx); }
}

/** A peer's path that is not an avatar URL produced by this instance. */
async function malformedAvatar(ctx: HandlerContext): Promise<Response> {
  return gap(ctx, true);
}
