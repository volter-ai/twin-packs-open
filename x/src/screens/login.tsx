// x.com's sign-in (a flow, twin-world's architecture "Who is on a screen"): where a person nobody has signed in yet is sent
// by every page that needs one (the home timeline: ./home.tsx), with the page to return to (`redirect_after_login`).
//
//   GET  /i/flow/login   "Sign in to X": "Phone, email, or username", "Password", "Log in" (world-ui's SignIn, in X's skin)
//   POST /i/flow/login   the account found by its username or its person's email, the password checked against the one
//                        the World gave it (POST /_twin/accounts `password`); right, X's session cookie (`auth_token`) is
//                        set and the person returned where they came from; wrong, the page again with X's words
//
// Where the documentation stops: x.com asks for the account and the password on two steps of one dialog; the twin asks
// for both on one page, with X's labels. A phone number is not modelled (an account the World makes has none). Signing
// out is not built: no act of the launch reaches it.
import type { HandlerContext } from '@volter/world-core';
import { personOf, personWith } from '@volter/world-core';
import { flowPage, formOf, SIGN_IN_CSS, SignIn, startSession } from '@volter/world-ui';
import { X_WEB_HOSTS } from '../semantics/shared.ts';
import { namedHost, onePath, placeOf, SESSION_COOKIE, signedInAccount } from './shared.tsx';

const X_MARK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23e7e9ea' d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'/></svg>";

/** X's skin over the sign-in page's layout. */
const SKIN = `
body{background:#000;color:#e7e9ea;font-family:"TwitterChirp",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.sign-in{max-width:364px;padding-top:48px}.sign-in-mark{background:url("${X_MARK}") center/40px no-repeat;border-radius:0}
.sign-in-heading{font-weight:700;font-size:31px;line-height:36px;text-align:left}
.sign-in-box{border:0;padding:0;gap:4px}.sign-in-box label{color:#71767b;font-size:13px}
.sign-in-box input[type=text],.sign-in-box input[type=password]{background:#000;color:#e7e9ea;border-color:#333639;border-radius:4px;padding:12px 8px;font-size:17px}
.sign-in-submit{margin-top:16px;background:#eff3f4;color:#0f1419;border-color:#eff3f4;border-radius:9999px;padding:10px 16px;font-weight:700;font-size:15px}
.sign-in-error{border-color:#f4212e;color:#f4212e}
`;

/** Where to return the person, normalised to an address on this site, else the home timeline. The address is resolved
 *  against x.com, and kept only when it names:
 *  - one of X's web hosts (x.com, twitter.com, www. and mobile.), or a path, taken as one path on x.com: its dot segments
 *    resolved and its leading slashes one (./shared.tsx onePath), so it can name neither another site nor a place
 *    outside the twin's base;
 *  - X's OAuth 1.0a screens on api.x.com (or api.twitter.com), which send a visitor here first: by their address on
 *    api.x.com, which X's session cookie (Domain .x.com) reaches; at a World's place, where every host is the twin's one
 *    base, by their path on the base.
 *  A backslash or a control character anywhere refuses it (a browser reads `/\evil.example` as `//evil.example`). */
function returnPath(value: string | null | undefined, placed: string | undefined): string {
  if (!value || /[\\\x00-\x1f\x7f]/.test(value)) return '/home';
  let url: URL;
  try { url = new URL(value, 'https://x.com'); } catch { return elsewhere(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return elsewhere();
  const host = url.hostname.toLowerCase();
  const path = onePath(`${url.pathname}${url.search}`);
  if ((X_WEB_HOSTS as readonly string[]).includes(host)) return path;
  const api = (host === 'api.x.com' || host === 'api.twitter.com') && /^\/oauth\/(?:authorize|authenticate)$/.test(url.pathname);
  return api ? (placed === undefined ? `https://api.x.com${path}` : path) : elsewhere();
}

/** An address on any other site: never followed (an open redirect), the person is sent home instead. */
function elsewhere(): string {
  return '/home';
}

/** Where the sign-in sends the person: the return address on the twin's base at a World's place, else as it is; checked
 *  once more where it lands, so the move stays on x.com, on api.x.com's authorize screens, or under the base. */
function landing(next: string, placed: string | undefined): string {
  const location = next.startsWith('/') ? `${placed ?? ''}${next}` : next;
  const at = new URL(location, 'https://x.com');
  const inside = placed === undefined
    ? (at.origin === 'https://x.com' || at.origin === 'https://api.x.com') && !location.startsWith('//')
    : at.origin === 'https://x.com' && (at.pathname === placed || at.pathname.startsWith(`${placed}/`));
  return inside ? location : `${placed ?? ''}/home`;
}

/** X's session cookie covers its hosts (Domain .x.com: x.com and api.x.com), so a person signed in at x.com's sign-in
 *  is signed in at api.x.com's authorize screens too. Where the twin is reached at its own address or a World's place,
 *  every page is on one origin and the cookie stays as the kernel scopes it. */
function sessionAcrossHosts(answer: Response, onXcom: boolean): Response {
  if (!onXcom) return answer;
  const headers = new Headers(answer.headers);
  const cookies = headers.getSetCookie();
  headers.delete('set-cookie');
  for (const cookie of cookies) headers.append('set-cookie', cookie.startsWith(`${SESSION_COOKIE}=`) ? `${cookie}; Domain=.x.com` : cookie);
  return new Response(answer.body, { status: answer.status, headers });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const placed = placeOf(ctx);
  if (request.method !== 'POST') {
    const next = returnPath(new URL(request.url).searchParams.get('redirect_after_login'), placed);
    if (signedInAccount(ctx)) return new Response(null, { status: 302, headers: { location: landing(next, placed) } });
    return page(placed, next, '');
  }
  const form = formOf(ctx);
  const next = returnPath(form.redirect_after_login, placed);
  const given = (form.identifier ?? '').trim();
  // the account by its handle (an @ before it as a person types it) or its person's email
  const handle = given.replace(/^@/, '').toLowerCase();
  const account = ctx.rowsRaw('account').find((a) => a.deleted !== true && String(a.username).toLowerCase() === handle);
  const person = account
    ? ctx.rowsRaw('_person').find((p) => p.account_id === account.id)
    : personOf(ctx, given);
  if (!person || typeof person.account_id !== 'string') return page(placed, next, given, 'Sorry, we could not find your account.', 400);
  if (!personWith(ctx, String(person.email), form.password ?? '')) return page(placed, next, given, 'Wrong password!', 401);
  return sessionAcrossHosts(await startSession(ctx, String(person.email), SESSION_COOKIE, landing(next, placed)), placed === undefined && namedHost(request) === 'x.com');
}

function page(placed: string | undefined, next: string, identifier: string, error?: string, status = 200): Response {
  return flowPage({
    title: 'Log in to X / X',
    css: [SIGN_IN_CSS, SKIN],
    status,
    body: (
      <SignIn
        heading="Sign in to X"
        action={`${placed ?? ''}/i/flow/login`}
        fields={{ redirect_after_login: next }}
        account={{ name: 'identifier', label: 'Phone, email, or username', value: identifier }}
        password={{ name: 'password', label: 'Password' }}
        submit="Log in"
        {...(error ? { error } : {})}
      />
    ),
  });
}
