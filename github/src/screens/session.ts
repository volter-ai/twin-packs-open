// THE SIGN-IN FORM'S ANSWER — POST github.com/session: a person's username or email address and password checked
// against the password the World keeps for them (its hash). Right, and without two-factor authentication, they are
// signed in (`user_session`) and sent back where they came from; with it, their session waits for its code (`_gh_sess`,
// screens/sessions.tsx). Wrong, the sign-in page again, "Incorrect username or password".
import type { HandlerContext } from '@volter/world-core';
import { beginSession, passwordOf } from '../semantics/shared.ts';
import { field, seeOther } from './shared.tsx';

const cookie = (name: string, value: string): string => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`;

export async function screen(ctx: HandlerContext): Promise<Response> {
  if (ctx.call.request.method !== 'POST') return seeOther('/login');
  const given = field(ctx, 'login').trim();
  const returnTo = field(ctx, 'return_to') || '/';
  const byEmail = ctx.rowsRaw('user_email').find((e) => String(e.email).toLowerCase() === given.toLowerCase());
  const u = ctx.rowsRaw('user').find((x) => String(x.login).toLowerCase() === given.toLowerCase() || (byEmail !== undefined && x.login === byEmail._login));
  if (!u || typeof u._password !== 'string' || u._password !== passwordOf(String(u.login), field(ctx, 'password'))) {
    return seeOther(`/login?error=1&login=${encodeURIComponent(given)}&return_to=${encodeURIComponent(returnTo)}`);
  }
  if (typeof u._totp === 'string') {
    const id = await beginSession(ctx, String(u.login), 'pending', returnTo);
    return seeOther('/sessions/two-factor/app', { 'set-cookie': cookie('_gh_sess', id) });
  }
  const id = await beginSession(ctx, String(u.login), 'active', returnTo);
  return seeOther(returnTo, { 'set-cookie': cookie('user_session', id) });
}
