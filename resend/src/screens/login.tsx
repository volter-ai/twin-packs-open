// Resend's sign-in (resend.com/login): a team member's email and password, checked against the person their sign-up
// recorded (personWith); right, the dashboard's session cookie is set and they return where they came from (`next`,
// the Domains page by default); wrong, the page again.
import { personWith, type HandlerContext } from '@volter/world-core';
import { formOf, startSession } from '@volter/world-ui';
import { SESSION_COOKIE } from '../semantics/shared.ts';
import { accountPage, nextOf } from './shared.tsx';

function form(email: string, next: string, error?: string, status = 200): Response {
  return accountPage('Log in', <>
    <h1>Log in to Resend</h1>
    {error ? <p role="alert">{error}</p> : null}
    <form method="post" action="/login">
      <input type="hidden" name="next" value={next}/>
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" defaultValue={email}/>
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password"/>
      <button type="submit">Log in</button>
    </form>
  </>, status);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method === 'GET') return form('', new URL(request.url).searchParams.get('next') ?? '');
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, POST' } });
  const fields = formOf(ctx);
  const email = (fields.email ?? '').trim().toLowerCase();
  // Where the documentation stops: the refusal's words are the twin's
  if (!personWith(ctx, email, fields.password ?? '')) return form(email, fields.next ?? '', 'Invalid email or password.', 401);
  return startSession(ctx, email, SESSION_COOKIE, nextOf(fields.next));
}
