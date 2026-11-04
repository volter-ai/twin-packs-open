// GET /logout: the top bar's logout link beside the name of the person signed in (../../spec/openapi.json).
import type { HandlerContext } from '@volter/world-core';
import { endSession, gotoOf, logoutAuthOf, noOneSignedOut, signedInAs } from './shared.ts';

export async function logout(ctx: HandlerContext): Promise<Response> {
  // a logout with no page to return to lands on the site's address (news.ycombinator.com/logout, read 2026-10-03: 302 to /)
  const goto = gotoOf(ctx.params.goto, '/');
  const user = signedInAs(ctx);
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(rlinkf 'logout (req) (when-umatch/r user req (logout-user user) whence))"
  if (!user) return noOneSignedOut(ctx, goto);
  // Where the source stops: its link is a closure drawn for the person (app.arc's when-umatch/r, whose mismatch is a
  // redirect too); the live site's carries an auth, and a link whose auth is not this person's signs no one out
  if (String(ctx.params.auth ?? '') !== await logoutAuthOf(ctx, user)) return noOneSignedOut(ctx, goto);
  return endSession(ctx, goto);
}
