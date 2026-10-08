// What OpenAI's dashboard pages share (docs/contributing/architecture.md, "Screens"): its skin over @volter/world-ui's
// pieces, the dashboard's session cookie, and the person signed in as OpenAI's user of the organization.
import { flowPage as codexFlowPage, PORTAL_CSS, SIGN_IN_CSS, signedIn } from '@volter/world-ui';
import type { HandlerContext } from '@volter/world-core';

/** The dashboard's session cookie. */
export const COOKIE = 'platform_session';

/** A person of the organization, as the dashboard knows them: OpenAI's user (organization.user). */
export type User = { id: string; email: string; name: string; role: 'owner' | 'reader'; added_at: number };

/** The user the request's session cookie names, or undefined when nobody is signed in. */
export function userOf(ctx: HandlerContext): User | undefined {
  const person = signedIn(ctx, COOKIE);
  return person ? { id: String(person.user_id), email: person.email, name: String(person.name), role: person.role === 'owner' ? 'owner' : 'reader', added_at: Number(person.added_at) } : undefined;
}

/** A return_to the log-in follows: a path on the dashboard, never another site. */
export const returnTo = (raw: string | null | undefined): string => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');

/** Keep dashboard navigation and form actions at the place the World served this page. */
export function dashboardPath(ctx: HandlerContext, path: string): string {
  const base = new URL(ctx.publicBase).pathname.replace(/\/+$/, '');
  return base && (path === base || path.startsWith(`${base}/`)) ? path : `${base}${path}`;
}

// OpenAI's skin: its black primary button on white
const FONT = 'body { background: #ffffff; color: #0d0d0d; font-family: "Söhne", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }';
export const SIGN_IN_PAGE_CSS = [SIGN_IN_CSS, `
${FONT}
.sign-in-mark { background: #0d0d0d; }
.sign-in-error { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
.sign-in-box { background: #ffffff; border-color: #ececec; }
.sign-in-box input[type=text], .sign-in-box input[type=password] { border-color: #d9d9d9; }
.sign-in-submit { background: #0d0d0d; border-color: #0d0d0d; color: #ffffff; }
`];
export const PORTAL_PAGE_CSS = [PORTAL_CSS, `
${FONT}
.portal-side { background: #f9f9f9; border-right: 1px solid #ececec; }
.portal-section h2 { border-color: #ececec; color: #5d5d5d; }
.portal-notice { background: #f0fdf4; border: 1px solid #bbf7d0; }
.portal-detail, .portal-note { color: #5d5d5d; }
.portal-button { border-color: #d9d9d9; color: #0d0d0d; }
.portal-primary { background: #0d0d0d; border-color: #0d0d0d; color: #ffffff; }
.portal-danger { color: #d00e17; border-color: #f3b4b7; }
.portal-field input, .portal-field select { border-color: #d9d9d9; }
`];

// OpenAI documents the user-facing browser/device round trip, not the private hosted form fields.
// The twin combines account sign-in and consent; its fields are its own UI contract.
// source: https://developers.openai.com/codex/auth "one-time code"
export function codexSignInPage(device: boolean, query: string, error?: string, notice?: string): Response {
  return codexFlowPage({
    title: 'Sign in to Codex', css: SIGN_IN_PAGE_CSS,
    body: <main className="sign-in"><h1 className="sign-in-heading">Sign in to Codex</h1>
      {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
      <form method="post" action={device ? '/codex/device' : '/oauth/authorize'} className="sign-in-box">
        <input type="hidden" name="query" value={query}/>
        <label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="username" required/>
        <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required/>
        {device ? <><label htmlFor="user_code">One-time code</label><input id="user_code" name="user_code" autoComplete="one-time-code" required/></> : null}
        <button className="sign-in-submit" type="submit">Continue</button>
      </form></main>,
  });
}
