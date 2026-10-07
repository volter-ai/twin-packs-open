// An invitation's link, the `/tickets` family of the Frontend API: where the email Clerk sends an invitee points.
import type { HandlerContext } from '@volter/world-core';
import { readTicket, rootOf, type Row, ticketRefused } from './shared.ts';

/** `GET /v1/tickets/accept?ticket=`: "Parses a ticket JWT and performs the necessary actions depending on the ticket's
 *  source type … a successful response can either redirect to a new location with the ticket in the query string, or
 *  respond directly with a text/html content type" (spec: acceptTicket). An organization invitation's ticket goes on to
 *  the invitation's `redirect_url` with `__clerk_ticket` and `__clerk_status` (`sign_in` when its address already has an
 *  account, `sign_up` when not), where the application signs the invitee up or in with it. */
export async function acceptTicket(ctx: HandlerContext): Promise<Response> {
  const root = await rootOf(ctx);
  const ticket = new URL(ctx.call.request.url).searchParams.get('ticket') ?? undefined;
  const read = readTicket(root, ticket);
  if (read instanceof Response) return read;
  // the twin serves an invitation's link only: a sign-in token has no link (its `url` is null, ../../../src/semantics/
  // sign_in_tokens.ts), and a client signs in with it directly (a sign-in's strategy `ticket`)
  if (read.kind !== 'invitation') return ticketRefused('invalid');
  const target = root.row('OrganizationInvitation', String(read.invitation.id))?._redirect_url;
  const known = root.rows('User').some((u) => ((u.email_addresses as Row[] | undefined) ?? []).some((e) => String(e.email_address).toLowerCase() === read.email));
  const status = known ? 'sign_in' : 'sign_up';
  if (typeof target !== 'string' || !target) {
    return new Response(`<!doctype html><p>Your invitation is ready. Open the application to ${known ? 'sign in' : 'sign up'}.</p>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const location = `${target}${target.includes('?') ? '&' : '?'}__clerk_ticket=${ticket}&__clerk_status=${status}`;
  return new Response(null, { status: 303, headers: { location } });
}
