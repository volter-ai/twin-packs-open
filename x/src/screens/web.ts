// x.com's root and X's other web hosts (the manifest's `web` screen, a workspace at `/`, the path a World's console
// frames). At x.com's root a person signed in is sent home, and a visitor to the sign-in flow, which returns them home
// (./login.tsx). twitter.com answers as X does, with a permanent move to the same path on x.com, and so do www. and
// mobile. for every page the pack claims (the post and profile pages, ./post.tsx and ./profile.tsx, the home timeline
// and the sign-in flow). Where the evidence stops: x.com's root shows a visitor a landing page ("Happening now", its
// Sign in); the twin draws none and sends the visitor on to the sign-in flow it leads to.
import type { HandlerContext } from '@volter/world-core';
import { HOME_PATH, LOGIN_PATH, PROFILE_PATH, ROOT_PATH, STATUS_PATH } from '../semantics/shared.ts';
import { moveTo, namedHost, placeOf, plainNotFound, signedInAccount } from './shared.tsx';

const MOVES: Record<string, { status: number; to: string }> = {
  'twitter.com': { status: 301, to: 'https://x.com' },
  'www.x.com': { status: 301, to: 'https://twitter.com' },
  'www.twitter.com': { status: 301, to: 'https://twitter.com' },
  'mobile.twitter.com': { status: 302, to: 'https://twitter.com' },
  'mobile.x.com': { status: 302, to: 'https://x.com' },
};
const CLAIMED = [new RegExp(STATUS_PATH), new RegExp(PROFILE_PATH), new RegExp(HOME_PATH), new RegExp(LOGIN_PATH), new RegExp(ROOT_PATH)];

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !CLAIMED.some((p) => p.test(url.pathname))) return plainNotFound();
  const placed = placeOf(ctx);
  // at a World's place the twin's base stands for x.com itself
  const move = placed === undefined ? MOVES[namedHost(request)] : undefined;
  if (move) return new Response(null, { status: move.status, headers: { location: `${move.to}${url.pathname}${url.search}` } });
  return signedInAccount(ctx) ? moveTo('/home', placed) : moveTo(`/i/flow/login?redirect_after_login=${encodeURIComponent('/home')}`, placed);
}
