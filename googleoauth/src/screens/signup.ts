// Google's sign-up (accounts.google.com/signup): a person makes their Google account, its address (a new gmail.com
// address, or one they already hold) and its password, and is signed in. The account is the `account` row the Google
// packs read (by its sub), its person the kernel's `_person` beside it (recordPerson, keeping the password's hash), and
// the sign-in the `SID` session on .google.com (semantics/shared.ts), so Gmail's webmail opens signed in.
//
//   GET  /signup   "Create a Google Account": First name, Last name, Email, Password, Next
//   POST /signup   email, password, given_name?, family_name?, continue?: the account made and the person signed in, then
//                  returned to `continue` (a Google page) or shown the account; a taken address or a short password is
//                  the page again with Google's words
//
// Where the documentation stops: Google asks for the name, the address and the password over several steps (birthday,
// gender and recovery details among them); the twin asks for the four a World's seed declares, on one page, with the
// field names of the generated seed's sign-up body (ADR 0033 §3). Phone verification is not modelled.
import { personOf, recordPerson, type HandlerContext } from '@volter/world-core';
import { ACCOUNT, accountSub, accountsPage, continueTo, esc, googleSession } from '../semantics/shared.ts';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function form(fields: Record<string, string>, error?: string, status = 200): Response {
  const field = (name: string, label: string, type: string, auto: string) =>
    `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" autocomplete="${auto}" value="${type === 'password' ? '' : esc(fields[name])}">`;
  return accountsPage('Create your Google Account', `<h1>Create a Google Account</h1><p>Enter your name, your address and a password</p>${error ? `<p role="alert">${esc(error)}</p>` : ''}<form method="post" action="/signup"><input type="hidden" name="continue" value="${esc(fields.continue)}">${field('given_name', 'First name', 'text', 'given-name')}${field('family_name', 'Last name (optional)', 'text', 'family-name')}${field('email', 'Email', 'email', 'username')}${field('password', 'Password', 'password', 'new-password')}<button type="submit">Next</button></form>`, status);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method === 'GET') return form({ continue: new URL(request.url).searchParams.get('continue') ?? '' });
  if (request.method !== 'POST') return new Response('Error 405 (Method Not Allowed)', { status: 405, headers: { allow: 'GET, POST' } });
  const fields = Object.fromEntries(new URLSearchParams(ctx.text)) as Record<string, string>;
  const email = (fields.email ?? '').trim().toLowerCase();
  const password = fields.password ?? '';
  if (!EMAIL.test(email)) return form(fields, 'Enter a valid email address', 400);
  // Google's own words for an address that already has an account, and for a short password
  if (personOf(ctx, email) || ctx.rowsRaw(ACCOUNT).some((a) => a.deleted !== true && a.email === email)) return form(fields, 'That username is taken. Try another.', 400);
  if (password.length < 8) return form(fields, 'Use 8 characters or more for your password', 400);
  const given = (fields.given_name ?? '').trim() || null;
  const family = (fields.family_name ?? '').trim() || null;
  const sub = await accountSub(ctx, email);
  await ctx.write(ACCOUNT, sub, { email, name: [given, family].filter(Boolean).join(' ') || null, given_name: given, family_name: family, picture: null }, 'account.create');
  await recordPerson(ctx, email, password, { sub });
  const cookie = await googleSession(ctx, email);
  const next = continueTo(fields.continue);
  if (next) return new Response(null, { status: 302, headers: { location: next, 'set-cookie': cookie } });
  return accountsPage('Google Account', `<h1>Welcome, ${esc(given ?? email)}</h1><p>Your Google Account <strong>${esc(email)}</strong> is ready, and you are signed in.</p>`, 200, { 'set-cookie': cookie });
}
