// TWO-FACTOR AUTHENTICATION — github.com/sessions/two-factor/app (a hosted flow): a person whose password was right and
// who has two-factor authentication on enters the code their authenticator app shows (RFC 6238, engine/totp.ts),
// posted to /sessions/two-factor; right, they are signed in and sent back where they came from; wrong, asked again.
import { sha256, type HandlerContext } from '@volter/world-core';
import { totpAccepts } from '../engine/totp.ts';
import { beginSession, cookieOf, nowSeconds, SESSIONS } from '../semantics/shared.ts';
import { field, page, seeOther } from './shared.tsx';

const cookie = (name: string, value: string): string => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const pendingId = cookieOf(ctx.call.request, '_gh_sess');
  const pending = pendingId ? ctx.row(SESSIONS, sha256(pendingId)) : undefined;
  if (!pending || pending.state !== 'pending') return seeOther('/login');
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  if (ctx.call.request.method === 'POST' && path === '/sessions/two-factor') {
    const u = ctx.row('user', String(pending.login));
    if (u && typeof u._totp === 'string' && totpAccepts(String(u._totp), nowSeconds(ctx), field(ctx, 'app_otp'))) {
      await ctx.write(SESSIONS, sha256(pendingId!), { state: 'done' }, 'session.second_factor');
      const id = await beginSession(ctx, String(pending.login), 'active', String(pending.return_to ?? '/'));
      return seeOther(String(pending.return_to ?? '/'), { 'set-cookie': `${cookie('user_session', id)}` });
    }
    // source: https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/troubleshooting-two-factor-authentication-issues "If you are receiving a \"Two-factor authentication failed\" error when authenticating with two-factor authentication (2FA), the authentication code you are entering is incorrect."
    // Where documentation stops: the page gives the refusal text but no HTTP status; 401 below is the twin's inferred authentication-refusal status, not a documented GitHub status.
    return form(true, 401);
  }
  return form(false);
}

function form(failed: boolean, status = 200): Response {
  return page('Two-factor authentication', (
    <>
      <h1>Two-factor authentication</h1>
      {failed ? <div className="gh-flash">Two-factor authentication failed.</div> : null}
      <form className="gh-box" method="post" action="/sessions/two-factor">
        <label htmlFor="app_totp">Authentication code</label>
        <input type="text" id="app_totp" name="app_otp" autoComplete="one-time-code" inputMode="numeric" />
        <p className="gh-muted">Open your two-factor authenticator (TOTP) app or browser extension to view your authentication code.</p>
        <button type="submit">Verify</button>
      </form>
    </>
  ), status);
}
