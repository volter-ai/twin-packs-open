// twitch.tv's log-in (a flow, docs/contributing/architecture.md "Who is on a screen"): where every page that needs a
// person logged in sends a visitor first, with the page to return to (`redirect`).
//
//   GET  /login   "Log in to Twitch": "Username", "Password", "Log In" (world-ui's SignIn, in Twitch's skin)
//   POST /login   the account by its username, the password checked against the one the World gave it; right, the
//                 session cookie is set for every twitch.tv host and the person returned where they came from; wrong, the
//                 page again with Twitch's words
//
// Where the documentation stops: twitch.tv's log-in is its own client's dialog; its labels and its refusals' words here
// are Twitch's own. Signing up and signing out are not built: no act of the demand reaches them.
import { personWith, type HandlerContext } from '@volter/world-core';
import { flowPage, SIGN_IN_CSS, SignIn, startSession } from '@volter/world-ui';
import { SESSION_COOKIE, userByLogin } from '../semantics/shared.ts';
import { formOf, hostOf, linkTo, onePath, personOn, placeOf, sessionAcrossHosts, TWITCH_HOSTS, TWITCH_LOGO_PATH } from './shared.tsx';

/** Twitch's skin over the sign-in layout. */
const SKIN = `
body{background:#0e0e10;color:#efeff1;font-family:Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif}
.sign-in{max-width:400px;padding-top:64px}.sign-in-mark{background:url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9147ff" d="${TWITCH_LOGO_PATH}"/></svg>`)}") center/40px no-repeat;border-radius:0}
.sign-in-heading{font-weight:700;font-size:24px}
.sign-in-box{border:0;padding:0;gap:4px}.sign-in-box label{font-weight:600;font-size:13px}
.sign-in-box input[type=text],.sign-in-box input[type=password]{background:#ffffff1a;color:#efeff1;border:2px solid transparent;border-radius:6px;padding:8px 10px;font-size:14px}
.sign-in-box input:focus{border-color:#9147ff;outline:0;background:#000}
.sign-in-submit{margin-top:16px;background:#9147ff;color:#fff;border:0;border-radius:4px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer}
.sign-in-error{border-color:#eb0400;color:#ff8280}
`;

/** Where to return the person: a path of www.twitch.tv, or a page on one of twitch.tv's hosts; anything else is the
 *  front page (never an open redirect). A backslash or a control character refuses it. */
function returnTo(value: string | null | undefined, ctx: HandlerContext): { host: string; path: string } {
  const home = { host: 'www.twitch.tv', path: '/' };
  if (!value || /[\\\x00-\x1f\x7f]/.test(value)) return home;
  let url: URL;
  try { url = new URL(value, 'https://www.twitch.tv'); } catch { return home; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !TWITCH_HOSTS.includes(url.hostname)) return home;
  return { host: placeOf(ctx) === undefined ? url.hostname : hostOf(ctx.call.request), path: onePath(`${url.pathname}${url.search}`) };
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method !== 'POST') {
    const back = returnTo(new URL(request.url).searchParams.get('redirect'), ctx);
    if (personOn(ctx)) return new Response(null, { status: 302, headers: { location: linkTo(back.host, back.path, ctx) } });
    return page(ctx, new URL(request.url).searchParams.get('redirect') ?? '', '');
  }
  const form = formOf(ctx);
  const back = returnTo(form.redirect, ctx);
  const username = (form.username ?? '').trim();
  const user = userByLogin(ctx, username);
  // Where the documentation stops: the words are twitch.tv's own for an unknown username and a wrong password
  if (!user) return page(ctx, form.redirect ?? '', username, 'This username does not exist.', 400);
  if (!personWith(ctx, String(user.email), form.password ?? '')) return page(ctx, form.redirect ?? '', username, 'That password was incorrect. Please try again.', 401);
  return sessionAcrossHosts(await startSession(ctx, String(user.email), SESSION_COOKIE, linkTo(back.host, back.path, ctx)), ctx);
}

function page(ctx: HandlerContext, redirect: string, username: string, error?: string, status = 200): Response {
  return flowPage({
    title: 'Log in - Twitch',
    css: [SIGN_IN_CSS, SKIN],
    status,
    body: (
      <SignIn
        heading="Log in to Twitch"
        action={linkTo('www.twitch.tv', '/login', ctx)}
        fields={{ redirect }}
        account={{ name: 'username', label: 'Username', value: username }}
        password={{ name: 'password', label: 'Password' }}
        submit="Log In"
        {...(error ? { error } : {})}
      />
    ),
  });
}
