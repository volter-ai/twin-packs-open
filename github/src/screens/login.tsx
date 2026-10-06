// GITHUB'S SIGN-IN PAGE — github.com/login (a hosted flow, docs/contributing/architecture.md, "Screens"): a username or
// email address and a password, posted to /session (screens/session.ts), with the page to return to. A person already
// signed in goes straight back.
import type { HandlerContext } from '@volter/world-core';
import { field, page, person, seeOther } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const returnTo = field(ctx, 'return_to') || '/';
  if (person(ctx)) return seeOther(returnTo);
  const failed = field(ctx, 'error') === '1';
  return page('Sign in to GitHub', (
    <>
      <h1>Sign in to GitHub</h1>
      {failed ? <div className="gh-flash">Incorrect username or password.</div> : null}
      <form className="gh-box" method="post" action="/session">
        <label htmlFor="login_field">Username or email address</label>
        <input type="text" id="login_field" name="login" value={field(ctx, 'login')} autoComplete="username" />
        <label htmlFor="password">Password</label>
        <input type="password" id="password" name="password" autoComplete="current-password" />
        <input type="hidden" name="return_to" value={returnTo} />
        <button type="submit" name="commit" value="Sign in">Sign in</button>
      </form>
    </>
  ), failed ? 401 : 200);
}
