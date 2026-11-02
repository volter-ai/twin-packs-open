// VERCEL'S SIGN-IN — vercel.com/login: "Continue with Email", a six-digit one-time password emailed to the address, then
// the code entered (https://vercel.com/docs/accounts), which starts the session. A code signs in once, within ten
// minutes. Where the documentation stops: the code's lifetime, the email's words and the cookie's name are the twin's. A
// flow (docs/contributing/architecture.md, "Screens").
import { personOf, type HandlerContext } from '@volter/world-core';
import { flowPage, formOf, SignInCode, SIGN_IN_CSS, startSession } from '@volter/world-ui';
import { COOKIE, SKIN } from './shared.tsx';

const nextOf = (raw: string | null | undefined): string => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/account/tokens');

function page(next: string, step: 'email' | 'code', email = '', error?: string, status = 200): Response {
  return flowPage({
    title: 'Login | Vercel', css: [SIGN_IN_CSS, SKIN], status,
    body: step === 'email'
      ? <SignInCode heading="Log in to Vercel" hint="We will email you a one-time password." action="/login" fields={{ next }} code={{ name: 'email', label: 'Email Address' }} submit="Continue with Email" {...(error ? { error } : {})} />
      : <SignInCode heading="Enter the code we emailed you" hint={`Sent to ${email}.`} action="/login/verify" fields={{ next, email }} code={{ name: 'code', label: 'One-time password' }} submit="Verify" {...(error ? { error } : {})} />,
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  if (request.method === 'GET') return page(nextOf(url.searchParams.get('next')), 'email');
  const f = formOf(ctx);
  const next = nextOf(f.next);
  const email = (f.email ?? '').trim().toLowerCase();
  if (url.pathname.replace(/\/+$/, '') === '/login') {
    // a code for a person Vercel knows; for anyone else the page answers as if one were sent
    if (personOf(ctx, email)) {
      const id = ctx.mint('_mail');
      const code = String(100000 + (Number.parseInt(ctx.crypto.digest('sha256', await ctx.secret(`otp:${id}:${email}`)).slice(0, 8), 16) % 900000));
      await ctx.record('_mail', { to: email, subject: 'Vercel verification code', text: `Your Vercel verification code is ${code}. It expires in 10 minutes.`, sent: ctx.occurredAt, _code: code }, id);
    }
    return page(next, 'code', email);
  }
  const code = (f.code ?? '').trim();
  const sent = ctx.rowsRaw('_mail').filter((m) => m.to === email && m._code === code && Date.parse(ctx.occurredAt) - Date.parse(String(m.sent)) <= 600_000);
  const fresh = sent.find((m) => ctx.history('_mail', String(m.id)).length === 1);
  if (!fresh) return page(next, 'code', email, 'Invalid or expired code', 401);
  await ctx.record('_mail', { used: ctx.occurredAt }, String(fresh.id));
  return startSession(ctx, email, COOKIE, next);
}
