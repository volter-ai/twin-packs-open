// id.twitch.tv's authorize page (a hosted flow, docs/contributing/architecture.md "Screens"): where an app sends a person
// to authorize it (the authorization code grant flow), and the round trip its pages document.
//
//   GET  /oauth2/authorize?response_type=code&client_id&redirect_uri&scope&state   a person not logged in is asked to log
//        in first ("Log in to Twitch": Username, Password, Log In); a person logged in sees what the app may do, with
//        Authorize and Cancel
//   POST /oauth2/authorize   intent=login: the log-in, then the page again; intent=authorize: the browser sent to the
//        redirect URI with `code`, `scope` and `state`; intent=cancel: sent there with `error=access_denied`,
//        `error_description` and `state`
//
// Where the documentation stops: Twitch documents the round trip, not its page. The page's words and controls are
// Twitch's labels; its answer to a client id or redirect URI it does not know is the status-and-message form its other
// endpoints refuse in. The implicit grant flow (response_type=token) is the gap: no demanded app uses it. An app the
// person already authorized is asked again (force_verify's default is not modelled).
import { personWith, type HandlerContext } from '@volter/world-core';
import { Consent, CONSENT_CSS, flowPage, SIGN_IN_CSS, SignIn, startSession } from '@volter/world-ui';
import { applicationOf, idError, issueCode, SCOPE_WORDS, SESSION_COOKIE, sessionUser, userById, userByLogin, type Row } from '../semantics/shared.ts';

const SKIN = `
body{background:#0e0e10;color:#efeff1;font-family:Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif}
.sign-in{max-width:400px;padding-top:64px}.sign-in-heading,.consent-heading{font-weight:700;font-size:22px}
.sign-in-box{border:0;padding:0}.sign-in-box input[type=text],.sign-in-box input[type=password]{background:#ffffff1a;color:#efeff1;border:2px solid transparent;border-radius:6px;padding:8px 10px}
.sign-in-submit,.consent-allow{background:#9147ff;color:#fff;border:0;border-radius:4px;padding:8px 16px;font-weight:600;cursor:pointer}
.consent-deny{background:#ffffff26;color:#efeff1;border:0;border-radius:4px;padding:8px 16px;font-weight:600;cursor:pointer}
.consent-box{background:#18181b;border:0;border-radius:6px}.consent-badge{background:#9147ff;color:#fff}
.sign-in-error{border-color:#eb0400;color:#ff8280}
`;

/** The request's parameters, as the app sent them and the page's forms carry them on. */
const FIELDS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'force_verify'] as const;
type Ask = Record<(typeof FIELDS)[number], string>;

const isTwitchHost = (request: Request): boolean => (request.headers.get('x-volter-twin-original-host') ?? new URL(request.url).hostname).toLowerCase().endsWith('twitch.tv') && !request.headers.has('x-forwarded-prefix');

/** Where the page is: its own path, on id.twitch.tv or at the World's place. */
function here(ctx: HandlerContext): string {
  const prefix = ctx.call.request.headers.get('x-forwarded-prefix');
  return prefix && /^\/[A-Za-z0-9._~/-]*$/.test(prefix) ? `${new URL(ctx.publicBase).pathname.replace(/\/+$/, '')}/oauth2/authorize` : '/oauth2/authorize';
}

/** The browser sent back to the app's redirect URI with the round trip's parameters. */
// source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "the server sends the authorization code to your redirect URI (see the code query parameter)"
function back(ask: Ask, params: Record<string, string>): Response {
  const to = new URL(ask.redirect_uri);
  for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
  if (ask.state) to.searchParams.set('state', ask.state);
  return new Response(null, { status: 302, headers: { location: to.href } });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const posted = request.method === 'POST' ? Object.fromEntries(new URLSearchParams(ctx.text)) : {};
  const query = new URL(request.url).searchParams;
  const ask = Object.fromEntries(FIELDS.map((f) => [f, String(request.method === 'POST' ? posted[f] ?? '' : query.get(f) ?? '')])) as Ask;
  const app = applicationOf(ctx, ask.client_id);
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "The authorization code is sent to this URI."
  if (!app) return idError(400, 'invalid client');
  if (!(app.redirect_uris as string[]).includes(ask.redirect_uri)) return idError(400, 'Parameter redirect_uri does not match registered URI');
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "Must be set to code ."
  if (ask.response_type === 'token') return ctx.gap();
  if (ask.response_type !== 'code') return idError(400, 'Parameter response_type is not valid');
  const scopes = ask.scope.split(/\s+/).filter(Boolean);
  let person = sessionUser(ctx);
  if (request.method === 'POST' && posted.intent === 'login') {
    const user = userByLogin(ctx, posted.username ?? '');
    if (!user || !personWith(ctx, String(user.email), posted.password ?? '')) return logIn(ctx, ask, posted.username ?? '', user ? 'That password was incorrect. Please try again.' : 'This username does not exist.');
    const started = await startSession(ctx, String(user.email), SESSION_COOKIE, `${here(ctx)}?${new URLSearchParams(ask)}`);
    if (!isTwitchHost(request)) return started;
    // the session is twitch.tv's, for every one of its hosts
    const headers = new Headers(started.headers);
    const cookies = headers.getSetCookie();
    headers.delete('set-cookie');
    for (const c of cookies) headers.append('set-cookie', `${c}; Domain=.twitch.tv`);
    return new Response(null, { status: started.status, headers });
  }
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "Twitch first asks them to log in and then asks them to authorize your application."
  if (!person) return logIn(ctx, ask, '');
  if (request.method === 'POST' && posted.intent === 'cancel') {
    // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "the server sends the error code and description to your redirect URI"
    return back(ask, { error: 'access_denied', error_description: 'The user denied you access' });
  }
  if (request.method === 'POST' && posted.intent === 'authorize') {
    person = person as Row;
    const code = await issueCode(ctx, { clientId: String(app.client_id), userId: String(person.id), scopes, redirectUri: ask.redirect_uri });
    return back(ask, { code, scope: scopes.join(' ') });
  }
  const owner = userById(ctx, String(app.owner_id));
  return flowPage({
    title: 'Authorize - Twitch',
    css: [CONSENT_CSS, SKIN],
    body: (
      <Consent
        heading={`Authorize ${String(app.name)}`}
        app={{ name: String(app.name), ...(owner ? { by: String(owner.display_name) } : {}) }}
        request={`wants to access your Twitch account, ${String(person.display_name)}`}
        permissions={scopes.map((s) => ({ title: SCOPE_WORDS[s] ?? s, detail: s }))}
        action={here(ctx)}
        fields={{ ...ask }}
        deny={{ name: 'intent', value: 'cancel', label: 'Cancel' }}
        allow={{ name: 'intent', value: 'authorize', label: 'Authorize' }}
        note={`You'll be redirected to ${new URL(ask.redirect_uri).origin}`}
      />
    ),
  });
}

function logIn(ctx: HandlerContext, ask: Ask, username: string, error?: string): Response {
  return flowPage({
    title: 'Log in - Twitch',
    css: [SIGN_IN_CSS, SKIN],
    status: error ? 401 : 200,
    body: (
      <SignIn
        heading="Log in to Twitch"
        action={here(ctx)}
        fields={{ ...ask, intent: 'login' }}
        account={{ name: 'username', label: 'Username', value: username }}
        password={{ name: 'password', label: 'Password' }}
        submit="Log In"
        {...(error ? { error } : {})}
      />
    ),
  });
}
