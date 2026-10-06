// GITHUB'S DEVICE FLOW — github.com/login/device (a hosted flow,
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow): a client without a
// browser (`gh auth login`) asks POST /login/device/code for a device code and a user code; the person, signed in, enters
// the user code at /login/device and authorizes the application for the scopes it asked; the client's poll of
// /login/oauth/access_token (screens/oauth.tsx) then gets its token. A code lasts fifteen minutes.
import { sha256, type HandlerContext } from '@volter/world-core';
import { nowSeconds, serial } from '../semantics/shared.ts';
import { clientOf, DEVICES, field, page, person, refused, scopesOf, toSignIn } from './shared.tsx';

type Row = Record<string, unknown>;

/** The letters a user code is made of: no vowels or look-alikes, as GitHub's `WDJB-MJHT` codes are. */
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

/** An answer as the Accept header asks: JSON, or GitHub's default form encoding. */
function answer(ctx: HandlerContext, fields: Record<string, string | number>, status = 200): Response {
  if ((ctx.call.request.headers.get('accept') ?? '').includes('json')) return Response.json(fields, { status });
  return new Response(new URLSearchParams(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]))).toString(), { status, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' } });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  if (path === '/login/device/code' && ctx.call.request.method === 'POST') return codes(ctx);
  if (path === '/login/device/confirm' && ctx.call.request.method === 'POST') return confirm(ctx);
  if (path !== '/login/device') return unknownPath();
  return ctx.call.request.method === 'POST' ? entered(ctx) : entry(ctx, false);
}

/** POST /login/device/code {client_id, scope}: a device code (the client's), a user code (the person's), where to enter
 *  it, and how often to poll. */
async function codes(ctx: HandlerContext): Promise<Response> {
  const clientId = field(ctx, 'client_id');
  const c = clientOf(ctx, clientId);
  if (!c) return answer(ctx, { error: 'unauthorized_client', error_description: 'The client_id is not valid.' }, 401);
  const n = await serial(ctx, 'device_code');
  const seed = ctx.crypto.digest('sha256', await ctx.secret(`device:${clientId}:${n}:${ctx.occurredAt}`), 'hex');
  const deviceCode = seed.slice(0, 40);
  const letters = [...seed.slice(40, 56)].map((h, i) => LETTERS[(parseInt(h, 16) + i) % LETTERS.length]).join('');
  const userCode = `${letters.slice(0, 4)}-${letters.slice(4, 8)}`;
  await ctx.write(DEVICES, sha256(deviceCode), { client_id: clientId, user_code: userCode, scopes: c.kind === 'oauth' ? scopesOf(field(ctx, 'scope')) : [], at: nowSeconds(ctx), interval: 5, state: 'pending' }, 'device_code.create');
  return answer(ctx, { device_code: deviceCode, user_code: userCode, verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5 });
}

/** The device code a user code names, while it waits. */
function waiting(ctx: HandlerContext, userCode: string): { key: string; row: Row } | undefined {
  const code = userCode.trim().toUpperCase().replace(/[^A-Z]/g, '');
  const row = ctx.rowsRaw(DEVICES).find((d) => String(d.user_code).replace('-', '') === code && d.state === 'pending' && nowSeconds(ctx) - Number(d.at) <= 899);
  return row ? { key: String(row.id), row } : undefined;
}

/** The page a person enters the code on. */
function entry(ctx: HandlerContext, failed: boolean): Response {
  if (!person(ctx)) return toSignIn(ctx);
  return page('Device Activation', (
    <>
      <h1>Device Activation</h1>
      {failed ? <div className="gh-flash">Recheck the code and try again.</div> : null}
      <form className="gh-box" method="post" action="/login/device">
        <label htmlFor="user-code">Enter the code displayed on your device</label>
        <input type="text" id="user-code" name="user_code" autoComplete="off" />
        <button type="submit">Continue</button>
      </form>
    </>
  ), failed ? 422 : 200);
}

/** The code entered: the application and the scopes it asks, to authorize. */
async function entered(ctx: HandlerContext): Promise<Response> {
  const login = person(ctx);
  if (!login) return toSignIn(ctx);
  const hit = waiting(ctx, field(ctx, 'user_code'));
  const c = hit ? clientOf(ctx, String(hit.row.client_id)) : undefined;
  if (!hit || !c) return entry(ctx, true);
  const name = String(c.app.name);
  const scopes = (hit.row.scopes as string[] | undefined) ?? [];
  return page(`Authorize ${name}`, (
    <>
      <h1>Authorize {name}</h1>
      <form className="gh-box" method="post" action="/login/device/confirm">
        <p><strong>{name}</strong> wants to access your <strong>{login}</strong> account</p>
        {scopes.length ? <ul>{scopes.map((s) => <li key={s}><code>{s}</code></li>)}</ul> : <p className="gh-muted">Public data only: limited access to your public data.</p>}
        <input type="hidden" name="user_code" value={String(hit.row.user_code)} />
        <button type="submit" name="authorize" value="1">Authorize {name}</button>
        <button type="submit" name="authorize" value="0" className="gh-quiet">Cancel</button>
      </form>
    </>
  ));
}

/** The person's answer: the device authorized for them, or declined. */
async function confirm(ctx: HandlerContext): Promise<Response> {
  const login = person(ctx);
  if (!login) return toSignIn(ctx);
  const hit = waiting(ctx, field(ctx, 'user_code'));
  if (!hit) return entry(ctx, true);
  const yes = field(ctx, 'authorize') === '1';
  // source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps "For users who have authorized scopes for the application, the user won't be shown the OAuth authorization page with the list of scopes."
  if (yes) {
    const clientId = String(hit.row.client_id);
    const grant = ctx.row('oauth_grant', `${login}#${clientId}`);
    await ctx.write('oauth_grant', `${login}#${clientId}`, { login, client_id: clientId, scopes: [...new Set([...((grant?.scopes as string[] | undefined) ?? []), ...((hit.row.scopes as string[] | undefined) ?? [])])].sort(), at: nowSeconds(ctx) }, 'oauth_grant.set');
  }
  await ctx.write(DEVICES, hit.key, yes ? { state: 'authorized', login } : { state: 'denied' }, yes ? 'device_code.authorize' : 'device_code.deny');
  return page(yes ? 'Congratulations' : 'Authorization cancelled', (
    <>
      <h1>{yes ? "Congratulations, you're all set!" : 'Authorization cancelled'}</h1>
      <div className="gh-box"><p>{yes ? 'Your device is now connected.' : 'The device was not given access to your account.'}</p></div>
    </>
  ));
}

/** A malformed peer path beneath this screen's prefix. */
function unknownPath(): Response {
  return refused(404, 'Not Found');
}
