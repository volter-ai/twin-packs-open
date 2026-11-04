// SIGN OUT — www.linkedin.com/m/logout/, the Me menu's Sign out (a flow, docs/contributing/architecture.md, "Who is on a
// screen"): the `li_at` cookie cleared and the person back at linkedin.com, signed out, where another may sign in; a
// visitor nobody signed in is sent to sign in, as linkedin.com answers (./shared.tsx toSignIn). Where the documentation
// stops: the help page names the menu item, not its address or where it lands; the address is the one linkedin.com
// answers, and the twin sends the person to its root, which offers the sign-in.
import { endBrowserSession, isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { COOKIE, memberOf, seeOther, toSignIn } from './shared.tsx';

// (the manifest's logout screen cites LinkedIn Help's "Select Sign out.")
export async function screen(ctx: HandlerContext): Promise<Response> {
  if (!memberOf(ctx)) return toSignIn(ctx);
  const cookie = isReadOnlyRequest(ctx.call.request) ? `${COOKIE}=; Max-Age=0; path=/; HttpOnly; Secure; SameSite=Lax` : await endBrowserSession(ctx, COOKIE);
  return seeOther(ctx, '/', { 'set-cookie': cookie });
}
