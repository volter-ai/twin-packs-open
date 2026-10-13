// Slack's email sign-in, https://slack.com/help/articles/212681477-Sign-in-to-Slack (read 2026-10-08):
// email, confirmation code in email, then the member's browser session. No external mail is sent.
// The code is in the existing /_twin/mail inbox. SSO/passkeys/Apple/Google and workspace switching are gaps.
// Twin decisions: opaque challenge and cookie names; a six-digit code expires after ten World minutes.
import { personOf, recordPerson, type HandlerContext } from '@volter/world-core';
import { formOf, startSession } from '@volter/world-ui';
import { now, sendMail, serial } from '../semantics/shared.ts';
import { CLIENT_COOKIE, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;
const CHALLENGES = '_signin_challenge';
const nextOf = (value: string | null | undefined): string => value?.startsWith('/') && !value.startsWith('//') ? value : '/client';
const memberOf = (ctx: HandlerContext, email: string): Row | undefined => ctx.rowsRaw('user').find(u => u.deleted !== true && String((u.profile as Row | undefined)?.email ?? '').toLowerCase() === email);
const SKIN = `
body:has(.slack-signin){background:#fff}.sk:has(.slack-signin){max-width:520px;margin:32px auto;padding:0 24px}.slack-signin .wordmark{text-align:center;font-size:28px;font-weight:800;margin-bottom:38px}.slack-signin h1{text-align:center;font-size:36px;line-height:1.15;margin-bottom:16px}.slack-signin .lead{text-align:center;color:#616061;line-height:1.5;margin-bottom:28px}.slack-signin .sk-card{padding:0;border:0}.slack-signin input{padding:13px 16px}.slack-signin button{width:100%;background:#611f69;padding:13px 16px;margin-top:18px}.slack-signin .notice{color:#616061;line-height:1.5}@media(max-width:600px){.slack-signin h1{font-size:30px}}
`;

function form(ctx: HandlerContext, next: string, challenge?: Row, error?: string, status = 200): Response {
  return page('Sign in', <section className="slack-signin">
    <div className="wordmark">Slack</div>
    <h1>{challenge ? 'Check your email for a code' : 'Sign in to Slack'}</h1>
    <p className="lead">{challenge ? <>We sent a confirmation code to <strong>{String(challenge.email)}</strong>.</> : 'Enter the email address you use for your workspace.'}</p>
    {error ? <p className="sk-notice" role="alert">{error}</p> : null}
    <form className="sk-card" method="post" action={`${ctx.publicBase}/signin`}>
      <input type="hidden" name="next" value={next}/>
      {challenge ? <><input type="hidden" name="challenge" value={String(challenge.id)}/><label htmlFor="code">Confirmation code</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/><button type="submit">Continue</button></> : <><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required/><button type="submit">Sign In with Email</button></>}
    </form>
  </section>, status, [SKIN]);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method !== 'GET' && request.method !== 'POST') return refused(405, 'Method not allowed');
  if (request.method === 'GET') {
    const next = nextOf(new URL(request.url).searchParams.get('next'));
    return visitor(ctx)?.row ? new Response(null, {status: 302, headers: {location: `${ctx.publicBase}${next}`}}) : form(ctx, next);
  }
  const fields = formOf(ctx);
  const next = nextOf(fields.next);
  if (!fields.challenge) {
    const email = (fields.email ?? '').trim().toLowerCase();
    if (!memberOf(ctx, email)) return form(ctx, next, undefined, 'No active workspace member was found for this email address.', 400);
    const id = ctx.crypto.digest('sha256', await ctx.secret(`signin:${email}:${await serial(ctx, 'signin')}`), 'hex');
    const code = String(Number.parseInt(ctx.crypto.digest('sha256', await ctx.secret(`signin-code:${id}`), 'hex').slice(0, 12), 16) % 1_000_000).padStart(6, '0');
    const challenge = {id, email, next, codeHash: ctx.crypto.digest('sha256', code, 'hex'), expires: now(ctx) + 600, used: false};
    await ctx.record(CHALLENGES, challenge, id);
    await sendMail(ctx, email, 'Your Slack confirmation code', `Your confirmation code is ${code}.`, []);
    return form(ctx, next, challenge);
  }
  const challenge = ctx.rowsRaw(CHALLENGES).find(c => c.id === fields.challenge);
  const member = challenge ? memberOf(ctx, String(challenge.email)) : undefined;
  if (!challenge || challenge.used === true || Number(challenge.expires) <= now(ctx) || !member) return form(ctx, next, undefined, 'This confirmation code has expired. Sign in again.', 400);
  if (ctx.crypto.digest('sha256', fields.code ?? '', 'hex') !== challenge.codeHash) return form(ctx, String(challenge.next), challenge, 'That confirmation code is not correct.', 400);
  await ctx.record(CHALLENGES, {...challenge, used: true}, String(challenge.id));
  const email = String(challenge.email);
  if (!personOf(ctx, email)) await recordPerson(ctx, email, await ctx.secret(`email-confirmed-person:${email}`));
  return startSession(ctx, email, CLIENT_COOKIE, `${ctx.publicBase}${nextOf(String(challenge.next))}`);
}
