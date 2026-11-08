// Google's sign-in (accounts.google.com/ServiceLogin): where Gmail and every Google page send a person nobody has signed
// in yet, with the page to return to (`continue`). The address and password are checked against the person their
// sign-up recorded (personWith, ./signup.ts); right, the `SID` session is set on .google.com and the person returned
// where they came from.
//
//   GET  /ServiceLogin   "Sign in": Email, Password, Next
//   POST /ServiceLogin   email, password, continue?: signed in and returned to `continue` (a Google page), else shown
//                        signed in; wrong, the page again with Google's words
//
// Where the documentation stops: Google asks for the address and the password on two steps of one flow; the twin asks
// for both on one page, with Google's labels. Two-step verification and account recovery are not modelled.
import { personOf, personWith, type HandlerContext } from '@volter/world-core';
import { accountsPage, continueTo, esc, googleSession } from '../semantics/shared.ts';

function form(email: string, next: string, error?: string, status = 200): Response {
  return accountsPage('Sign in - Google Accounts', `<h1>Sign in</h1><p>Use your Google Account</p>${error ? `<p role="alert">${esc(error)}</p>` : ''}<form method="post" action="/ServiceLogin"><input type="hidden" name="continue" value="${esc(next)}"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" value="${esc(email)}"><label for="password">Enter your password</label><input id="password" name="password" type="password" autocomplete="current-password"><button type="submit">Next</button></form>`, status);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method === 'GET') return form('', new URL(request.url).searchParams.get('continue') ?? '');
  if (request.method !== 'POST') return new Response('Error 405 (Method Not Allowed)', { status: 405, headers: { allow: 'GET, POST' } });
  const fields = Object.fromEntries(new URLSearchParams(ctx.text)) as Record<string, string>;
  const email = (fields.email ?? '').trim().toLowerCase();
  const next = fields.continue ?? '';
  if (!personOf(ctx, email)) return form(email, next, "Couldn't find your Google Account", 400);
  if (!personWith(ctx, email, fields.password ?? '')) return form(email, next, 'Wrong password. Try again or click Forgot password to reset it.', 401);
  const cookie = await googleSession(ctx, email);
  const to = continueTo(next);
  if (to) return new Response(null, { status: 302, headers: { location: to, 'set-cookie': cookie } });
  return accountsPage('Google Account', `<h1>Welcome, ${esc(email)}</h1><p>You are signed in.</p>`, 200, { 'set-cookie': cookie });
}
