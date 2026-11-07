// Resend's sign-up (resend.com/signup): a person opens their account, its team (an id Resend mints, labelled for their
// organization or for them), and is signed in. The person is the kernel's (`recordPerson`, the password kept as its hash)
// with the team they lead; the session is the dashboard's cookie (semantics/shared.ts SESSION_COOKIE). A World's generated seed opens an
// organization's declared account here (ADR 0033 §3: `email`, `password`, `given_name?`, `family_name?`,
// `organization?`), and the deployment's key then lands in that team (semantics/doors.ts appCredentials).
//
//   GET  /signup   "Create a Resend account": First name, Last name, Email, Password, Team name, Create account
//   POST /signup   the account made and the person signed in, then sent to the Domains page; a taken address or a short
//                  password is the page again
//
// Where the documentation stops: Resend's sign-up asks for an email and a password and names the team afterwards; the
// twin takes the team's name on the same form, with the field names of the generated seed's sign-up body. Email
// confirmation and the social sign-ins are not modelled.
import { personOf, recordPerson, type HandlerContext } from '@volter/world-core';
import { formOf, startSession } from '@volter/world-ui';
import { SESSION_COOKIE, TEAM } from '../semantics/shared.ts';
import { accountPage, nextOf } from './shared.tsx';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function form(fields: Record<string, string>, error?: string, status = 200): Response {
  const field = (name: string, label: string, type = 'text', auto = 'off') => <><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} autoComplete={auto} defaultValue={type === 'password' ? '' : fields[name] ?? ''}/></>;
  return accountPage('Create a Resend account', <>
    <h1>Create a Resend account</h1>
    {error ? <p role="alert">{error}</p> : null}
    <form method="post" action="/signup">
      <input type="hidden" name="next" value={fields.next ?? ''}/>
      {field('given_name', 'First name', 'text', 'given-name')}{field('family_name', 'Last name', 'text', 'family-name')}
      {field('email', 'Email', 'email', 'username')}{field('password', 'Password', 'password', 'new-password')}
      {field('organization', 'Team name', 'text', 'organization')}
      <button type="submit">Create account</button>
    </form>
  </>, status);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method === 'GET') return form({ next: new URL(request.url).searchParams.get('next') ?? '' });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, POST' } });
  const fields = formOf(ctx);
  const email = (fields.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return form(fields, 'Enter a valid email address.', 400);
  if (personOf(ctx, email)) return form(fields, 'An account with this email already exists.', 400);
  if ((fields.password ?? '').length < 8) return form(fields, 'Your password must be at least 8 characters.', 400);
  const given = (fields.given_name ?? '').trim();
  const family = (fields.family_name ?? '').trim();
  // the team is its own: an id Resend mints, labelled for the organization (labels may repeat, ADR 0033 §6)
  const label = (fields.organization ?? '').trim() || given || email.slice(0, email.indexOf('@'));
  const team = ctx.mint(TEAM);
  await ctx.record(TEAM, { name: label }, team);
  await recordPerson(ctx, email, fields.password!, { team, name: [given, family].filter(Boolean).join(' ') || null });
  return startSession(ctx, email, SESSION_COOKIE, nextOf(fields.next));
}
