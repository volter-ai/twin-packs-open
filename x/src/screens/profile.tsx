// x.com's profile page (the manifest's `profile` screen): what x.com serves at `https://x.com/<handle>`, the account
// and its posts, from the twin's own store; a post's page links its author's profile, and Volter's own sites link
// theirs (journeys/demand.json). The page reads the same projection the API serves (../semantics/shared.ts
// `webProfile`) and is drawn by ./shared.tsx. x.com's own routes (home, explore, settings and the rest) are never a
// handle (PROFILE_PATH).
import type { HandlerContext } from '@volter/world-core';
import { xSemantics } from '../semantics/index.ts';
import { PROFILE_PATH, webProfile } from '../semantics/shared.ts';
import { answerPage, engage, moveTo, pageOptions, plainNotFound, profilePage, signedInAccount } from './shared.tsx';

const PROFILE = new RegExp(PROFILE_PATH);

// Follow, pressed on another account's profile (./shared.tsx `engage`): the API's followUser as the person signed in,
// with the account as its target_user_id; a visitor nobody signed in is sent to the sign-in flow first.
// source: spec:/components/schemas/FollowUserRequest "target_user_id"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const path = new URL(request.url).pathname;
  if (!PROFILE.test(path)) return plainNotFound();
  const handle = path.replace(/^\/|\/$/g, '');
  const options = pageOptions(ctx);
  if (request.method === 'GET' || request.method === 'HEAD') return answerPage(request, options, () => profilePage(handle, options));
  if (request.method !== 'POST' || new URLSearchParams(ctx.text).get('intent') !== 'follow') return plainNotFound();
  const person = signedInAccount(ctx);
  if (!person) return moveTo(`/i/flow/login?redirect_after_login=${encodeURIComponent(`/${handle}`)}`, options.placed, 303);
  const user = webProfile(options.read(), handle)?.user as Record<string, unknown> | undefined;
  if (!user) return answerPage(request, options, () => profilePage(handle, options));
  const said = await engage(ctx, xSemantics, 'follow', person, { target_user_id: String(user.id) });
  if (!said) return moveTo(`/${handle}`, options.placed, 303);
  const shown = { ...options, notice: said };
  return answerPage(request, shown, () => profilePage(handle, shown));
}
