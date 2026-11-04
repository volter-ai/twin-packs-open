// REDDIT'S SIGN-IN — www.reddit.com/login (a hosted flow, twin-world's architecture, "Who is on a screen"): an email or
// username and a password, posted back to /login, with the page to return to (Reddit's `dest`). Right, the person is
// signed in (the `reddit_session` cookie) and sent where they were going; wrong, the page again with Reddit's words. A
// person already signed in goes straight on.
import { personWith, type HandlerContext } from '@volter/world-core';
import { formOf, SIGN_IN_CSS, SignIn, startSession, flowPage } from '@volter/world-ui';
import { personByLogin } from '../semantics/shared.ts';
import { SESSION_COOKIE } from './shared.tsx';
import { baseOf, REDDIT_CSS, SNOO, viewerOf, seeOther } from './shared.tsx';

const LOGIN_CSS = `.sign-in-mark{display:none}.sign-in{max-width:400px;padding-top:48px}.sign-in-heading{font-weight:700;font-size:24px}
.sign-in-box{border:0;padding:0}.sign-in-box input[type=text],.sign-in-box input[type=password]{border:1px solid #c4ced1;border-radius:999px;padding:12px 16px;background:#eaedef}
.sign-in-submit{border:0;border-radius:999px;background:#ff4500;color:#fff;height:48px;font-weight:600}.sign-in-error{border-color:#d93a00;color:#d93a00}
.login-snoo{display:flex;justify-content:center;padding-top:32px}`;

/** Where to go after: a path of this site, kept under the twin's base, or else its front page; none, its front page.
 *  A path with a backslash, a control character or a dot segment (`.`, `..`, encoded or not), or a second leading slash,
 *  could leave the site or the base once a browser resolves it, so it is no path of the site.
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/validator/validator.py "destination url (must be same-domain)"
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/validator/validator.py "if u.is_reddit_url(c.site) and u.is_web_safe_url():" */
const destOf = (raw: string | undefined): string => {
  if (!raw) return '/';
  const path = raw.split(/[?#]/)[0]!;
  const safe = raw.startsWith('/') && !raw.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(raw) && !/(^|\/)(?:\.|%2e){1,2}(?=\/|$)/i.test(path);
  return safe ? raw : '/';
};

export async function screen(ctx: HandlerContext): Promise<Response> {
  const base = baseOf(ctx);
  const url = new URL(ctx.call.request.url);
  if (ctx.call.request.method === 'POST') {
    const form = formOf(ctx);
    const asked = destOf(form.dest);
    const found = personByLogin(ctx, form.username ?? '');
    if (!found || !personWith(ctx, found.email, form.password ?? '')) return render(base, asked, form.username ?? '', 'Invalid username or password.', 400);
    const started = await startSession(ctx, found.email, SESSION_COOKIE, `${base ?? ''}${asked}`);
    return onRedditDomain(ctx, started);
  }
  const asked = destOf(url.searchParams.get('dest') ?? undefined);
  const viewer = await viewerOf(ctx);
  if (viewer) return seeOther(base, asked);
  return render(base, asked, '', undefined, 200);
}

/** The session set on Reddit's domain when the sign-in was reached at one of Reddit's own hosts, as r2 sets every cookie
 *  (its configured domain), so old.reddit.com and www.reddit.com share it; at a World's place (one origin, by path) or
 *  at the twin's own address the cookie stays the host's, since a browser drops a cookie for a domain it is not on.
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/cookies.py "self.domain = g.domain" */
function onRedditDomain(ctx: HandlerContext, answer: Response): Response {
  const request = ctx.call.request;
  const host = (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host).replace(/:\d+$/, '').toLowerCase();
  if (baseOf(ctx) !== undefined || !(host === 'reddit.com' || host.endsWith('.reddit.com'))) return answer;
  const headers = new Headers();
  for (const [name, value] of answer.headers) if (name !== 'set-cookie') headers.append(name, value);
  for (const cookie of answer.headers.getSetCookie()) headers.append('set-cookie', `${cookie}; Domain=.reddit.com`);
  return new Response(answer.body, { status: answer.status, headers });
}

function render(base: string | undefined, dest: string, username: string, error: string | undefined, status: number): Response {
  return flowPage({
    title: 'Reddit - Log In', css: [REDDIT_CSS, SIGN_IN_CSS, LOGIN_CSS], status,
    body: (
      <>
        <div className="login-snoo">{SNOO}</div>
        <SignIn heading="Log In" action={`${base ?? ''}/login`} fields={{ dest }} account={{ name: 'username', label: 'Email or username', value: username }} password={{ name: 'password', label: 'Password' }} submit="Log In" {...(error ? { error } : {})} />
      </>
    ),
  });
}
