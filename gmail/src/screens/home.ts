// gmail.com: the site sends its visitor to the webmail, which signs them in first when it must (./mail.ts).
import type { HandlerContext } from '@volter/world-core';

export async function screen(_ctx: HandlerContext): Promise<Response> {
  return new Response(null, { status: 301, headers: { location: 'https://mail.google.com/mail/' } });
}
