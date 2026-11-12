import type { HandlerContext } from '@volter/world-core';

export async function gap(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  // source: recording:agent-keys-post-403.json "agent_keys_disabled"
  if (request.method === 'POST' && url.pathname === '/v1/agent/keys' && !request.headers.get('apikey') && !url.searchParams.get('apikey')) {
    const body = String.raw`{"message":"Automated key issuance is not enabled for currencyapi. Sign up in the browser instead: https:\/\/app.currencyapi.com\/register","error":{"code":"agent_keys_disabled","message":"Automated key issuance is not enabled for currencyapi. Sign up in the browser instead: https:\/\/app.currencyapi.com\/register"},"actions":{"sign_up":"https:\/\/app.currencyapi.com\/register?utm_source=api_error&utm_campaign=agent_keys_disabled","docs":"https:\/\/currencyapi.com\/docs\/openapi.yaml"}}`;
    return new Response(new TextEncoder().encode(body), { status: 403 });
  }
  // The kernel renders the manifest's gap; no captured GET body or header is available.
  return ctx.refuse({ status: 404, message: 'Not Found' });
}
