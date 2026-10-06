// RESEND'S INBOUND CDN — a received email's raw message at its pre-signed URL (`raw.download_url`, an hour), which needs
// no key ("raw download URLs are pre-signed", as Twenty reads them). Where the documentation stops: the URL's host is the
// attachments' download host, the published example's raw host being a placeholder, and its signature the twin's. A
// content screen (docs/contributing/architecture.md, "Screens").
// source: https://resend.com/docs/api-reference/emails/list-received-email-attachments "inbound-cdn.resend.com"
import type { HandlerContext } from '@volter/world-core';
import { RECEIVED } from '../semantics/shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const m = /^\/receiving\/raw\/([^/]+)$/.exec(url.pathname);
  const r = m ? ctx.rowsRaw(RECEIVED).find((x) => x.id === m[1] && x.deleted !== true) : undefined;
  const expires = url.searchParams.get('Expires') ?? '';
  if (!r || !expires) return new Response('Not Found', { status: 404 });
  const signature = (await ctx.secret(`resend-raw:${String(r.id)}:${expires}`)).slice(0, 32);
  if (url.searchParams.get('Signature') !== signature || Date.parse(expires) <= Date.parse(ctx.occurredAt)) return new Response('Access Denied', { status: 403 });
  const bytes = await ctx.blobs.get(String(r._raw_blob));
  return new Response(bytes ? new Uint8Array(bytes) : null, { headers: { 'content-type': 'message/rfc822' } });
}
