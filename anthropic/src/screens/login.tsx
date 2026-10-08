// THE CONSOLE'S SIGN-IN — platform.claude.com/login: "Continue with email", a code emailed to the address, then the code
// entered, which starts the session every Console page reads. Where the documentation stops: the Console's sign-in is
// not documented; the code's six digits, its ten minutes, the email's words and the cookie's name are the twin's. A
// flow (docs/contributing/architecture.md, "Screens").
import { personOf, type HandlerContext } from '@volter/world-core';
import { flowPage, formOf, SignInCode, SIGN_IN_CSS, startSession } from '@volter/world-ui';
import { consolePath, COOKIE, SKIN } from './shared.tsx';

const nextOf = (raw: string | null | undefined): string => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/settings/keys');

function page(ctx: HandlerContext, next: string, step: 'email' | 'code', email = '', error?: string, status = 200): Response {
  return flowPage({
    title: 'Log in | Claude Console', css: [SIGN_IN_CSS, SKIN], status,
    body: step === 'email'
      ? <SignInCode heading="Log in to the Claude Console" hint="We will email you a login code." action={consolePath(ctx, '/login')} fields={{ next }} code={{ name: 'email', label: 'Email' }} submit="Continue with email" {...(error ? { error } : {})} />
      : <SignInCode heading="Check your email" hint={`We sent a code to ${email}.`} action={consolePath(ctx, '/login/verify')} fields={{ next, email }} code={{ name: 'code', label: 'Login code' }} submit="Verify" {...(error ? { error } : {})} />,
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  if (request.method === 'GET') return page(ctx, consolePath(ctx, nextOf(url.searchParams.get('next'))), 'email');
  const f = formOf(ctx);
  const next = consolePath(ctx, nextOf(f.next));
  const email = (f.email ?? '').trim().toLowerCase();
  if (url.pathname.replace(/\/+$/, '') === '/login') {
    // a code for a person the Console knows; for anyone else the page answers as if one were sent
    if (personOf(ctx, email)) {
      const id = ctx.mint('_mail');
      const code = String(100000 + (Number.parseInt(ctx.crypto.digest('sha256', await ctx.secret(`console-code:${id}:${email}`)).slice(0, 8), 16) % 900000));
      await ctx.record('_mail', { to: email, subject: 'Your Claude Console login code', text: `Your login code is ${code}. It expires in 10 minutes.`, sent: ctx.occurredAt, _code: code }, id);
    }
    return page(ctx, next, 'code', email);
  }
  const code = (f.code ?? '').trim();
  const sent = ctx.rowsRaw('_mail').filter((m) => m.to === email && m._code === code && Date.parse(ctx.occurredAt) - Date.parse(String(m.sent)) <= 600_000);
  const fresh = sent.find((m) => ctx.history('_mail', String(m.id)).length === 1);
  if (!fresh) return page(ctx, next, 'code', email, 'Invalid or expired code', 401);
  await ctx.record('_mail', { used: ctx.occurredAt }, String(fresh.id));
  return startSession(ctx, email, COOKIE, next);
}
