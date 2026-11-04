import { personWith, type HandlerContext } from '@volter/world-core';
import { Consent, CONSENT_CSS, flowPage, formOf, redirect, SignIn, SIGN_IN_CSS, signedIn, startSession } from '@volter/world-ui';
import { badRequest } from '../semantics/shared.ts';

// source: https://dev.bitly.com/docs/getting-started/authentication/ "Redirect the user to"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const p = { ...ctx.params, ...(ctx.call.request.method === 'POST' ? formOf(ctx) : {}) };
  const client = ctx.rowsRaw('_client').find(c => c.id === p.client_id);
  if (!client || p.redirect_uri !== client.redirect_uri) return badRequest();
  // Where the documentation stops: local sign-in/consent field names are a synthetic UI; the documented redirect is the contract.
  const person = signedIn(ctx, 'bitly_session');
  const fields = { client_id: String(p.client_id), redirect_uri: String(p.redirect_uri), state: String(p.state ?? '') };
  if (!person) {
    if (ctx.call.request.method === 'POST') {
      const login = personWith(ctx, String(p.email ?? ''), String(p.password ?? ''));
      if (!login) return badRequest();
      const next = `${ctx.publicBase}/oauth/authorize?${new URLSearchParams(fields)}`;
      return startSession(ctx, login.email, 'bitly_session', next);
    }
    return flowPage({ title: 'Log in to Bitly', css: [SIGN_IN_CSS], body: <SignIn heading="Log in to Bitly" action={`${ctx.publicBase}/oauth/authorize`} fields={fields} account={{ name: 'email', label: 'Email' }} password={{ name: 'password', label: 'Password' }} submit="Log in" /> });
  }
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "state parameter which will be included unchanged"
  const target = new URL(String(client.redirect_uri));
  if (p.state !== undefined) target.searchParams.set('state', String(p.state));
  if (ctx.call.request.method !== 'POST') return flowPage({ title: 'Authorize Dub', css: [CONSENT_CSS], body:
    <Consent heading="Authorize Dub" app={{ name: String(client.name) }} request={`wants to access your ${person.email} account`}
      permissions={[{ title: 'Read your links', detail: 'Import your Bitly archive into Dub.' }]} action={`${ctx.publicBase}/oauth/authorize`}
      fields={fields} deny={{ name: 'decision', value: 'deny', label: 'Cancel' }} allow={{ name: 'decision', value: 'allow', label: 'Allow' }} /> });
  if (p.decision !== 'allow') { target.searchParams.set('error', 'access_denied'); return redirect(target.toString()); }
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "Bitly appends a code parameter"
  const id = await ctx.issue('_code');
  const code = await ctx.secret(`bitly-code:${id}`);
  await ctx.write('_code', id, { sha256: ctx.crypto.sha256(code), email: person.email, client_id: client.id,
    redirect_uri: client.redirect_uri, used: false }, 'authorize');
  target.searchParams.set('code', code);
  return redirect(target.toString());
}
