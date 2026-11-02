// The identity service's sign-in page (worker/src/index.ts serves it): where an authorization request sends a browser.
// In a World the person signs in as one of the World's people (the doors make them), where id.volter.ai offers GitHub,
// Google, an emailed code or a passkey. The kernel calls `screen` for /login and the forms it posts (/login/social).
import type { HandlerContext } from '@volter/world-core';
import { beginSocial, esc, issuerOf, page, people, signIn, socialProviders, userByEmail } from '../semantics/shared.ts';

/** `/login`: the sign-in page. Its query is the authorization request; signing in continues it. */
// source: recording:ui-source.txt "const callbackURL = query.get(\"return_to\") ?? \"/\";"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  // "Continue with GitHub" / "Continue with Google": the provider's own sign-in, then back to the authorization request
  if (request.method === 'POST' && url.pathname === '/login/social') return continueSocial(ctx);
  if (request.method === 'POST') {
    const form = new URLSearchParams(ctx.text);
    const user = userByEmail(ctx, form.get('email') ?? '');
    if (!user) return page('Sign in', '<p>No Volter identity has that email.</p>');
    // the request continues signed in; a prompt=login it carried has been answered by this sign-in
    const query = new URLSearchParams(form.get('authorize') ?? '');
    query.delete('prompt');
    const returned = form.get('return_to');
    const location = !query.has('client_id') && returned?.startsWith('/') && !returned.startsWith('//') ? `${issuerOf(ctx)}${returned}` : `${issuerOf(ctx)}/api/auth/oauth2/authorize?${query.toString()}`;
    return new Response(null, { status: 303, headers: { 'set-cookie': await signIn(ctx, user), location } });
  }
  const social = socialProviders(ctx).map((p) => `<form method="post" action="/login/social"><input type="hidden" name="provider" value="${esc(p)}"><input type="hidden" name="authorize" value="${esc(url.searchParams.toString())}"><button type="submit">Continue with ${p === 'github' ? 'GitHub' : 'Google'}</button></form>`).join('');
  return page('Sign in', `<h1>Sign in to Volter</h1><p><small>Volter Identity (the World's twin of id.volter.ai)</small></p>${social}${social ? '<p><small>or, as one of the World\'s people:</small></p>' : ''}${people(ctx, '/login', { authorize: url.searchParams.toString(), return_to: url.searchParams.get('return_to') ?? '' })}`);
}


/** Social redirect only when this World is configured with a provider twin. */
async function continueSocial(ctx: HandlerContext): Promise<Response> {
  const form = new URLSearchParams(ctx.text);
  const to = await beginSocial(ctx, form.get('provider') ?? '', `${issuerOf(ctx)}/api/auth/oauth2/authorize?${form.get('authorize') ?? ''}`);
  return to ? new Response(null, { status: 303, headers: { location: to } }) : page('Sign in', '<p>That provider is not offered.</p>');
}
