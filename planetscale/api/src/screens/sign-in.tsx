// PLANETSCALE'S SIGN-IN — app.planetscale.com/sign-in: email and password, a session cookie naming the person to every
// dashboard page after. Where the documentation stops: the cookie's name is the twin's. A flow (docs/contributing/
// architecture.md, "Screens").
import { personWith, type HandlerContext } from '@volter/world-core';
import { flowPage, formOf, SignIn, SIGN_IN_CSS, startSession } from '@volter/world-ui';
import { COOKIE, SKIN } from './shared.tsx';

const nextOf = (raw: string | null | undefined): string => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');

function page(next: string, error?: string, status = 200): Response {
  return flowPage({
    title: 'Sign in | PlanetScale', css: [SIGN_IN_CSS, SKIN], status,
    body: <SignIn heading="Sign in to PlanetScale" action="/sign-in" fields={{ next }} account={{ name: 'email', label: 'Email' }} password={{ name: 'password', label: 'Password' }} submit="Sign in" {...(error ? { error } : {})} />,
  });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method === 'GET') return page(nextOf(new URL(request.url).searchParams.get('next')));
  const f = formOf(ctx);
  const email = (f.email ?? '').trim().toLowerCase();
  const next = nextOf(f.next);
  if (!personWith(ctx, email, f.password ?? '')) return page(next, 'Invalid email or password', 401);
  return startSession(ctx, email, COOKIE, next);
}
