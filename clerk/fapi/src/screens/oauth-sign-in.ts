// The OAuth sign-in uses the same unmodified clerk-js bundle and Frontend API session operations as an app.
import { oauthProxyError, oauthRequestHost } from '../semantics/shared.ts';
import type { HandlerContext } from '@volter/world-core';
import { publishableKey, htmlEscape as esc, oauthPage, oauthPublicBase, rootOf } from '../semantics/shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const proxyError = oauthProxyError(ctx);
  if (proxyError) return proxyError;
  const q = new URL(ctx.call.request.url).searchParams;
  const base = await oauthPublicBase(ctx);
  const returnTo = q.get('redirect_url');
  // The page's return destination is only this instance's authorize path; never accept an arbitrary redirect.
  if (!returnTo || !returnTo.startsWith(`${base}/oauth/authorize?`)) return new Response('Invalid return URL', { status: 400 });
  const back = new URL(returnTo);
  // The login prompt has been acted on by this sign-in page; preserve every other authorize parameter.
  const prompts = (back.searchParams.get('prompt') ?? '').split(/\s+/).filter((p) => p && p !== 'login');
  if (prompts.length) back.searchParams.set('prompt', prompts.join(' ')); else back.searchParams.delete('prompt');
  const pk = publishableKey(await rootOf(ctx));
  const target = JSON.stringify(back.toString()).replace(/</g, '\\u003c');
  // source: https://clerk.com/docs/quickstarts/javascript "mountSignIn"
  // source: https://clerk.com/docs/quickstarts/javascript "data-clerk-proxy-url"
  return oauthPage('Sign in', `<h1>Sign in</h1><div id="sign-in"></div><script async crossorigin="anonymous" data-clerk-publishable-key="${esc(pk)}"${oauthRequestHost(ctx) === 'frontend-api.clerk.dev' ? ` data-clerk-proxy-url="${esc(base)}"` : ''} src="${esc(base)}/npm/@clerk/clerk-js@5/dist/clerk.browser.js" onload="window.Clerk.load().then(() => { window.Clerk.mountSignIn(document.getElementById('sign-in'), {forceRedirectUrl: ${esc(target)}}) })"></script>`);
}
