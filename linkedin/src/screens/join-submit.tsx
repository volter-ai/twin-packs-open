// THE JOIN FORM'S ANSWER — POST www.linkedin.com/signup/api/cors/createAccount, where linkedin.com's join form names
// (./join.tsx): the member made as LinkedIn's sign-up makes one (the members door's ../semantics/shared.ts ensureMember),
// signed in (`li_at`) and sent on to where they were going. Where the documentation stops: linkedin.com's page sends
// this form by its script and moves on itself; the twin's page has no script, so the form posts and is answered with a
// redirect. What the join would not take (../semantics/shared.ts joinRefusal) is the join page again, saying why.
import { type HandlerContext } from '@volter/world-core';
import { startSession } from '@volter/world-ui';
import { ensureMember, joinRefusal } from '../semantics/shared.ts';
import { COOKIE, field, redirectOf, seeOther } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  if (ctx.call.request.method !== 'POST') return seeOther(ctx, '/signup/cold-join');
  const joining = { email: field(ctx, 'email-address').trim(), password: field(ctx, 'password'), given_name: field(ctx, 'first-name').trim(), family_name: field(ctx, 'last-name').trim() };
  const asked = field(ctx, 'session_redirect');
  const why = joinRefusal(ctx, joining);
  // the join page again, saying why, with what was typed but the password, as a page keeps a form
  if (why) return seeOther(ctx, `/signup/cold-join?error=${why}&email=${encodeURIComponent(joining.email)}&first=${encodeURIComponent(joining.given_name)}&last=${encodeURIComponent(joining.family_name)}&session_redirect=${encodeURIComponent(asked)}`);
  await ensureMember(ctx, joining);
  const next = redirectOf(asked);
  const started = await startSession(ctx, joining.email.toLowerCase(), COOKIE, next);
  return seeOther(ctx, next, { 'set-cookie': started.headers.get('set-cookie') ?? '' });
}
