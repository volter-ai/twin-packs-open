// What Clerk's Frontend API does around every request (docs/contributing/architecture.md, around.ts): clerk-js tunnels a
// non-simple verb through POST and `?_method=` to stay free of a CORS preflight, which the Frontend API reads as that
// verb; and a native client's request (`_is_native=true`) on an instance whose Native API is off is refused: "In the Clerk
// Dashboard, navigate to the Native applications page and enable the Native API. This is required to integrate Clerk in
// your native application" (https://clerk.com/docs/ios/getting-started/quickstart), as Clerk refuses it
// (https://clerk.com/docs/guides/development/errors/frontend-api: NativeAPIDisabled, 400 `native_api_disabled`).
import { oauthProxyError } from './shared.ts';
import type { HandlerContext } from '@volter/world-core';
import { ensureInstanceKey, instanceRow } from '../../../src/semantics/shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  // the instance's signing key, which every cookie's token is signed and read with, made before anything is answered
  await ensureInstanceKey(ctx);
  const request = ctx.call.request;
  const url = new URL(request.url);
  if (url.searchParams.get('_is_native') === 'true' && (instanceRow(ctx)?._auth as Record<string, unknown> | undefined)?.native_api !== true) {
    return ctx.refuse({ status: 400, code: 'native_api_disabled', kind: 'Native API disabled', message: 'The Native API is disabled for this instance. Visit the Clerk Dashboard to enable it.' });
  }
  const proxyError = oauthProxyError(ctx);
  if (proxyError) return proxyError;
  const override = url.searchParams.get('_method');
  if (request.method !== 'POST' || override === null) return next();
  const method = override.toUpperCase();
  return next(new Request(request.url, { method, headers: request.headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: await request.arrayBuffer() }) }));
}
