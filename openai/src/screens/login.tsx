// OPENAI'S LOG-IN — the door before the dashboard's pages (docs/contributing/architecture.md, "Who is on a screen"): the
// log-in page takes a person's email address and password, the right pair signs them in, and the dashboard's session
// cookie names them to every page after. A dashboard page asked for by nobody signed in sends its visitor to the log-in
// with `return_to`, and the log-in returns them there. Built from @volter/world-ui's sign-in piece under OpenAI's skin;
// nothing of OpenAI's page is copied.
//
// A person is an account of the World's organization, as the Admin API's user object gives one
// (https://platform.openai.com/docs/api-reference/users/object: id, name, email, role "owner" or "reader", added_at).
//
// Where OpenAI's documentation stops and the twin decides: an account is made at the World's door
// (`POST /_twin/accounts`, standing in for OpenAI's sign-up, which is not modelled), and the World keeps its password's
// hash, never the password; the World has one organization, whose first account is its owner and whose later ones join
// as readers unless the door names a role; the log-in is one page (OpenAI's asks for the email and the password on two),
// served on the dashboard's own host at platform.openai.com/login, the address OpenAI's log-in link opens (OpenAI hands it
// on to auth.openai.com, which the twin does not model as a host of its own), so its session cookie is the dashboard's;
// the session cookie's name (`platform_session`) is the twin's, as OpenAI documents none; a refused log-in shows the page
// again with the message, answered 200; and a session does not end: no person of a World logs out yet.
import { personWith, type HandlerContext } from '@volter/world-core';
import { flowPage, formOf, SignIn, startSession } from '@volter/world-ui';
import { COOKIE, returnTo, SIGN_IN_PAGE_CSS } from './shared.tsx';

function page(back: string, email?: string, error?: string): Response {
  return flowPage({
    title: 'Log in - OpenAI',
    css: SIGN_IN_PAGE_CSS,
    body: (
      <SignIn
        heading="Welcome back"
        action="/login"
        fields={{ return_to: back }}
        account={{ name: 'email', label: 'Email address', ...(email ? { value: email } : {}) }}
        password={{ name: 'password', label: 'Password' }}
        submit="Continue"
        {...(error ? { error } : {})}
      />
    ),
  });
}

/** platform.openai.com/login: the form, and the person it signs in (the log-in names neither which half was wrong). */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method !== 'POST') return page(returnTo(new URL(request.url).searchParams.get('return_to')));
  const form = formOf(ctx);
  const email = (form.email ?? '').trim();
  const back = returnTo(form.return_to);
  if (!personWith(ctx, email, form.password ?? '')) return page(back, email, 'Wrong email or password.');
  return startSession(ctx, email.toLowerCase(), COOKIE, back);
}
