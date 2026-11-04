// JOIN LINKEDIN — www.linkedin.com/signup/cold-join (a flow, docs/contributing/architecture.md, "Who is on a screen"):
// where linkedin.com sends a visitor at a post they may not see or that is gone (./shared.tsx toJoin), its
// `session_redirect` the post. As linkedin.com draws it (read with GET on 2026-10-03: "Sign Up | LinkedIn", "Join
// LinkedIn now — it’s free!"): Email, Password, First name, Last name and "Agree & Join", and "Already on LinkedIn?
// Sign in" to the sign-in at /uas/login, written as linkedin.com writes it, which returns the person to the same place.
// Its other ways in (Google's, Microsoft's) are not this World's. A member already signed in goes straight on.
import type { HandlerContext } from '@volter/world-core';
import { SIGN_IN_CSS } from '@volter/world-ui';
import { JOIN_REFUSALS } from '../semantics/shared.ts';
import { field, GlobalNav, memberOf, page, redirectOf, seeOther } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const asked = field(ctx, 'session_redirect');
  if (memberOf(ctx)) return seeOther(ctx, redirectOf(asked));
  const code = field(ctx, 'error');
  const failed = Object.hasOwn(JOIN_REFUSALS, code) ? JOIN_REFUSALS[code] : undefined;
  return page(ctx, 'Sign Up', (
    <>
      <GlobalNav member={undefined} next={asked} />
      <main className="sign-in">
        <h1 className="sign-in-heading">Join LinkedIn now — it’s free!</h1>
        {failed ? <div className="alert alert-error" role="alert">{failed}</div> : null}
        <form className="join-form sign-in-box" method="post" action="/signup/api/cors/createAccount">
          <input type="hidden" name="session_redirect" value={asked} />
          <label>Email <input type="email" name="email-address" required autoComplete="email" defaultValue={field(ctx, 'email')} /></label>
          <label>Password <input type="password" name="password" required autoComplete="new-password" /></label>
          <label>First name <input type="text" name="first-name" required defaultValue={field(ctx, 'first')} /></label>
          <label>Last name <input type="text" name="last-name" required defaultValue={field(ctx, 'last')} /></label>
          <button type="submit" className="btn btn-primary">Agree &amp; Join</button>
        </form>
        <p>Already on LinkedIn? <a href={`/uas/login?session_redirect=${encodeURIComponent(asked).replace(/\./g, '%2E')}&fromSignIn=true&trk=cold_join_sign_in`}>Sign in</a></p>
      </main>
    </>
  ), failed ? 400 : 200, [SIGN_IN_CSS]);
}
