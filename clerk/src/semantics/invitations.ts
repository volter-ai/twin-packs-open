import type { HandlerContext } from '@volter/world-core';
import { body, clerkError, frontendApiHost, invalid, ms, orderAndFilter, outOfRange, own, pageOf, query, signJwt, userByEmail } from './shared.ts';
type Row = Record<string, unknown>;
// source: spec:CreateInvitation "Creates a new invitation for the given email address and sends the invitation email."
export async function CreateInvitation(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx); const email = String(b.email_address ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('email_address', 'email_address must be a valid email address.');
  // source: spec:CreateInvitation "Whether an invitation should be created if there is already an existing invitation for this email address, or it's claimed by another user."
  if (!b.ignore_existing && (ctx.rows('Invitation').some(i => i.email_address === email && i.status === 'pending' && Number(i.expires_at) > ms(ctx)) || userByEmail(ctx, email))) {
    // The spec supplies 400 ClerkErrors without a code for this case; use its documented duplicate-record class.
    return clerkError(400, 'duplicate_record', 'An invitation or user already exists for this email address.');
  }
  // source: spec:CreateInvitation "The number of days the invitation will be valid for. By default, the invitation expires after 30 days."
  const refused = outOfRange('expires_in_days', b.expires_in_days, 1, 365); if (refused) return refused;
  const days = typeof b.expires_in_days === 'number' ? b.expires_in_days : 30;
  if (b.redirect_url !== undefined) { try { const u = new URL(String(b.redirect_url)); if (!['http:', 'https:'].includes(u.protocol)) return invalid('redirect_url', 'redirect_url must be an HTTP URL.'); } catch { return invalid('redirect_url', 'redirect_url must be an HTTP URL.'); } }
  if (b.public_metadata !== undefined && (!b.public_metadata || typeof b.public_metadata !== 'object' || Array.isArray(b.public_metadata))) return invalid('public_metadata', 'public_metadata must be a JSON object.');
  // source: spec:/paths/~1invitations/post/requestBody/content/application~1json/schema/properties/template_slug "waitlist_invitation"
  if (b.template_slug !== undefined && !['invitation', 'waitlist_invitation'].includes(String(b.template_slug))) return invalid('template_slug', 'template_slug must be invitation or waitlist_invitation.');
  const at = ms(ctx); const id = ctx.mint('Invitation');
  const ticket = signJwt(ctx, { st: 'invitation', sid: id, iid: id }, { now: Math.floor(at / 1000), expiresInSeconds: days * 86400 });
  // The spec makes the invitation URL opaque; the World carries its ticket on the instance's own origin as for organization invitations.
  const u = new URL(b.redirect_url ? String(b.redirect_url) : `https://${frontendApiHost(ctx)}/sign-up`); u.searchParams.set('__clerk_ticket', ticket);
  const row = await ctx.write('Invitation', id, { object: 'invitation', email_address: email, public_metadata: b.public_metadata ?? {}, revoked: false, status: 'pending', url: u.toString(), expires_at: at + days * 86400000, created_at: at, updated_at: at }, 'invitation.create');
  // source: spec:CreateInvitation "Optional flag which denotes whether an email invitation should be sent to the given email address."
  if (b.notify !== false) await ctx.record('_email', { to: email, template: b.template_slug ?? 'invitation', subject: "You've been invited", link: u.toString(), invitation_id: id, sent_at: at });
  return ctx.reply(own(ctx, row));
}
// source: spec:ListInvitations "Returns all non-revoked invitations for your application, sorted by creation date"
export async function ListInvitations(ctx: HandlerContext): Promise<Response> {
  for (const row of ctx.rows('Invitation')) {
    if (row.status === 'pending' && Number(row.expires_at) <= ms(ctx)) {
      ctx.legal('Invitation', 'status', 'invitation.expire', row.status, 'expired', String(row.id), 'external');
      await ctx.write('Invitation', String(row.id), { status: 'expired', updated_at: ms(ctx) }, 'invitation.expire');
    }
  }
  const q = query(ctx); const status = q.get('status');
  if (status && !['pending','accepted','revoked','expired'].includes(status)) return invalid('status', 'Invalid invitation status.');
  const rows = ctx.rows('Invitation').filter(i => i.status !== 'revoked' && (!status || i.status === status));
  const ordered = orderAndFilter(ctx, rows, '-created_at', ['created_at','email_address','expires_at'], ['email_address','id']);
  return ordered instanceof Response ? ordered : ctx.reply(pageOf(ctx, ordered).map(i => own(ctx, i)));
}
