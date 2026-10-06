// How Resend renders a webhook's `data` (the manifest's `events`): an outbound email's fields (its id, when it was
// made, from, to, subject, tags), with the bounce's detail for email.bounced; a received email's for email.received.
// source: spec:/components/schemas/OutboundEmailEventData "Unique identifier for the email."
import type { EventWrite, WriteHookContext } from '@volter/world-core';

type Row = Record<string, unknown>;

export function data(ctx: WriteHookContext, write: EventWrite, type: string): Record<string, unknown> {
  const r = (ctx.row(write.storedType, String(write.body.id ?? ''), { withDeleted: true }) ?? write.body) as Row;
  if (type === 'email.received') {
    return { email_id: r.id, created_at: r.created_at, from: r.from, to: r.to, subject: r.subject, message_id: r.message_id, bcc: r.bcc ?? [], cc: r.cc ?? [], received_for: r.to, attachments: [] };
  }
  const tags = Object.fromEntries(((r.tags as Row[] | undefined) ?? []).map((t) => [String(t.name), String(t.value)]));
  const base: Row = { email_id: r.id, created_at: new Date(Date.parse(String(r._created_iso))).toISOString(), from: r.from, to: type === 'email.bounced' ? r._bounced_to : r.to, subject: r.subject, ...(Object.keys(tags).length ? { tags } : {}) };
  // the recipient's server refused it outright: a permanent bounce, one diagnostic per recipient. Where the documentation
  // stops: the diagnostic and the message are the twin's words for a refusing server.
  // source: spec:/components/schemas/WebhookEventBounce "Detailed bounce message describing why the email bounced."
  if (type === 'email.bounced') return { ...base, bounce: { diagnosticCode: ((r._bounced_to as string[]) ?? []).map(() => 'smtp; 550 5.1.1 user unknown'), message: "The recipient's mail server permanently rejected the email.", subType: 'General', type: 'Permanent' } };
  if (type === 'email.opened') return { ...base, to: [r._opened_by] };
  if (type === 'email.complained') return { ...base, to: [r._complained_by] };
  return base;
}

/** The team an event is about (its email's or received email's), which an endpoint must belong to. */
export function values(ctx: WriteHookContext, write: EventWrite): Record<string, unknown> {
  const r = (ctx.row(write.storedType, String(write.body.id ?? ''), { withDeleted: true }) ?? write.body) as Row;
  return { $team: r._team };
}
