// LINKEDIN'S SIGN-IN — www.linkedin.com/login (a hosted flow, docs/contributing/architecture.md, "Who is on a screen"):
// an email and a password, posted to /checkpoint/lg/login-submit (./login-submit.tsx) with the page to return to
// (`session_redirect`). A member already signed in goes straight there. The same page answers at /uas/login, where
// linkedin.com sends a visitor from a member's page (./shared.tsx toSignIn; ./uas-login.tsx).
import type { HandlerContext } from '@volter/world-core';
import { SignIn, SIGN_IN_CSS } from '@volter/world-ui';
import { field, GlobalNav, memberOf, page, redirectOf, seeOther } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const next = redirectOf(field(ctx, 'session_redirect'));
  if (memberOf(ctx)) return seeOther(ctx, next);
  return signInPage(ctx, 'LinkedIn Login, Sign in', next);
}

/** The sign-in form, under a page's title: the sign-in's own, or linkedin.com's root as a visitor sees it. */
function signInPage(ctx: HandlerContext, title: string, next: string): Promise<Response> {
  const failed = field(ctx, 'error') === '1';
  return page(ctx, title, (
    <>
      <GlobalNav member={undefined} />
      <SignIn
        heading="Sign in" action="/checkpoint/lg/login-submit" fields={{ session_redirect: next }}
        account={{ name: 'session_key', label: 'Email or phone', value: field(ctx, 'session_key') }} password={{ name: 'session_password', label: 'Password' }}
        submit="Sign in" {...(failed ? { error: 'Wrong email or password. Try again or create an account.' } : {})}
      />
    </>
  ), failed ? 401 : 200, [SIGN_IN_CSS]);
}
