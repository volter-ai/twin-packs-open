// THE SIGN-IN FORM'S ANSWER — POST www.linkedin.com/checkpoint/lg/login-submit: an email and a password checked
// against the password the World keeps for the member (its hash). Right, the member is signed in (`li_at`) and sent
// where they were going; wrong, the sign-in page again.
import { personWith, type HandlerContext } from '@volter/world-core';
import { startSession } from '@volter/world-ui';
import { COOKIE, field, redirectOf, seeOther } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  if (ctx.call.request.method !== 'POST') return seeOther(ctx, '/login');
  const email = field(ctx, 'session_key').trim();
  const next = redirectOf(field(ctx, 'session_redirect'));
  if (!personWith(ctx, email, field(ctx, 'session_password'))) return wrongPassword(ctx, email, next);
  const started = await startSession(ctx, email, COOKIE, next);
  return seeOther(ctx, next, { 'set-cookie': started.headers.get('set-cookie') ?? '' });
}

/** A wrong email or password: the sign-in page again, saying so, the email kept. */
function wrongPassword(ctx: HandlerContext, email: string, next: string): Response {
  return seeOther(ctx, `/login?error=1&session_key=${encodeURIComponent(email)}&session_redirect=${encodeURIComponent(next)}`);
}
