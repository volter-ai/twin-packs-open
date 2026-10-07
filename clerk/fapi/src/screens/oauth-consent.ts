// The Account Portal consent page: its decision posts the vendor's consent operation.
import { membershipsOf, oauthProxyError } from '../semantics/shared.ts';
import type { HandlerContext } from '@volter/world-core';
import { htmlEscape as esc, oauthPage, oauthParams, oauthPublicBase, oauthRequest, signedIn } from '../semantics/shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const proxyError = oauthProxyError(ctx);
  if (proxyError) return proxyError;
  const q = oauthParams(ctx);
  const app = await oauthRequest(ctx, q);
  if (app instanceof Response) return app;
  const who = await signedIn(ctx);
  if (who instanceof Response) return who;
  // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "The requesting app's name and logo."
  // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "Clear accept/deny options."
  const inputs = [...q].filter(([k]) => k !== 'consented').map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "the OAuth consent screen displays an Organization selector"
  const orgs = q.get('scope')?.split(/\s+/).includes('user:org:read') ? `<label>Organization <select name="organization_id"><option value="">Personal account</option>${membershipsOf(who.root, String(who.user.id)).map((m) => { const org = who.root.get('Organization', String(m.organization_id)); return `<option value="${esc(m.organization_id)}">${esc(org?.name)}</option>`; }).join('')}</select></label>` : '';
  return oauthPage('Authorize application', `<h1>Authorize ${esc(app.name)}</h1><p>Signed in as ${esc(who.user.first_name ?? who.user.id)}</p><p>Requested access: ${esc(q.get('scope'))}</p><form method="post" action="${esc(await oauthPublicBase(ctx))}/v1/me/oauth/consent/${encodeURIComponent(String(app.client_id))}">${inputs}${orgs}<button name="consented" value="true">Allow</button><button name="consented" value="false">Deny</button></form>`);
}
