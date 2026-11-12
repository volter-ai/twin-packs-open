import type { HandlerContext } from '@volter/world-core';

export async function get_prohibited_email_domains_txt(ctx: HandlerContext) {
  // source: recording:prohibited-email-domains.json "text/plain; charset=utf-8"
  // The retained public file is zero bytes. No list contents beyond this snapshot are established.
  return new Response('', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
