import { personWith, type HandlerContext } from '@volter/world-core';
import { flowPage, SignIn, SIGN_IN_CSS, formOf, startSession } from '@volter/world-ui';
import { at, safeReturn } from './shared.tsx';
// source: https://developers.cloudflare.com/fundamentals/user-profiles/login/ "Log in"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const form = formOf(ctx); const next = safeReturn(ctx, form.next ?? new URL(ctx.call.request.url).searchParams.get('next') ?? at(ctx, '/profile/api-tokens'));
  const posted = ctx.call.request.method === 'POST';
  if (posted && personWith(ctx, form.email ?? '', form.password ?? '')) return startSession(ctx, (form.email ?? '').trim().toLowerCase(), 'cf_session', next);
  return flowPage({ title: 'Log in to Cloudflare', css: [SIGN_IN_CSS], status: posted ? 401 : 200,
    body: <SignIn heading="Log in to Cloudflare" action={at(ctx, '/login')} fields={{ next }} account={{ name: 'email', label: 'Email' }}
      password={{ name: 'password', label: 'Password' }} submit="Log in" error={posted ? 'Invalid email or password.' : undefined} /> });
}
