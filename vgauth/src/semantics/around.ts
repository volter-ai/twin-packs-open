import type { HandlerContext } from '@volter/world-core';
import { fail } from './shared.ts';
// source: recording:worker-source.txt "error instanceof Error ? error.message : 'Authorization failed'"
export async function around(ctx: HandlerContext, next: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try { response = await next(); }
  catch (e) { response = fail(502, e instanceof Error ? e.message : 'Authorization failed'); }
  // source: recording:worker-source.txt "headers: hardenedHeaders(new Headers(response.headers)),"
  const headers = new Headers(response.headers);
  // source: recording:worker-source.txt "headers.set('Cache-Control', 'no-store');"
  headers.set('Cache-Control', 'no-store');
  // source: recording:worker-source.txt "headers.set('Referrer-Policy', 'no-referrer');"
  headers.set('Referrer-Policy', 'no-referrer');
  // source: recording:worker-source.txt "headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');"
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // source: recording:worker-source.txt "headers.set('X-Content-Type-Options', 'nosniff');"
  headers.set('X-Content-Type-Options', 'nosniff');
  // source: recording:worker-source.txt "return new Response(response.body, {"
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
