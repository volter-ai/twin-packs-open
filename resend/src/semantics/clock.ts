// Resend's own moves as the World clock passes (docs/contributing/architecture.md, clock.ts):
// - a sent email reaches its recipients' servers five seconds after it was sent: delivered, or bounced when a
//   recipient's server refuses mail for its domain (the `recipients` door; Resend's bounced@resend.dev always refuses);
// - a pending domain is verified once every record is at the owner's DNS host ("will often verify within 15 minutes of
//   adding the DNS records": ten minutes after the later of the verify and the last record), and fails when they are
//   not all there 72 hours after it was verified.
// Where the documentation stops: the five seconds and the ten minutes are the twin's.
// source: https://resend.com/docs/add-a-domain "your domain will often verify within 15 minutes of adding the DNS records"
import type { HandlerContext } from '@volter/world-core';
import { DOMAIN, domainOf, EMAIL, type Row } from './shared.ts';

const at = (iso: unknown, ms: number): number => Date.parse(String(iso)) + ms;

/** The owner's record for one of a domain's records, when it is set as asked. */
function found(ctx: HandlerContext, domain: string, r: Row): Row | undefined {
  const name = String(r.name);
  const fqdn = name === domain || name.endsWith(`.${domain}`) ? name : `${name}.${domain}`;
  const strip = (v: unknown): string => String(v ?? '').replace(/^"|"$/g, '').replace(/\.$/, '');
  return ctx.rowsRaw('_dns').find((d) => d.name === fqdn && ctx.own(d).type === r.type && strip(d.value) === strip(r.value) && d.deleted !== true);
}

/** Verification times out when the owner has not installed every required record. */
// source: https://resend.com/docs/add-a-domain "If verification has not completed after 72 hours"
async function failVerification(ctx: HandlerContext, d: Row, records: Row[], set: Array<Row | undefined>): Promise<void> {
  const then = await ctx.at(new Date(at(d._verify_at, 72 * 3_600_000)).toISOString());
  await then.write(DOMAIN, String(d.id), { status: 'failed', records: records.map((r, i) => ({ ...r, status: set[i] ? 'verified' : 'failed' })) }, 'domain.failed');
}

/** The scheduled timestamp releases a send, after which its ordinary delivery clock applies. */
// source: spec:/components/schemas/SendEmailRequest/properties/scheduled_at "Schedule email to be sent later."
async function releaseScheduled(ctx: HandlerContext, e: Row): Promise<void> {
  const then = await ctx.at(String(e._scheduled_at));
  await then.write(EMAIL, String(e.id), { last_event: 'queued' }, 'email.release');
  await then.write(EMAIL, String(e.id), { last_event: 'sent', _sent_at: then.occurredAt }, 'email.send');
}

export async function clock(ctx: HandlerContext): Promise<void> {
  const now = Date.parse(ctx.occurredAt);
  for (const e of ctx.rowsRaw(EMAIL).filter((x) => x.last_event === 'scheduled' && Date.parse(String(x._scheduled_at)) <= now)) await releaseScheduled(ctx, e);
  for (const e of ctx.rowsRaw(EMAIL).filter((x) => x.last_event === 'sent' && x.deleted !== true)) {
    const due = at(e._sent_at, 5_000);
    if (due > now) continue;
    const then = await ctx.at(new Date(due).toISOString());
    const recipients = [...(e.to as string[]), ...((e.cc as string[]) ?? []), ...((e.bcc as string[]) ?? [])];
    const refusing = recipients.filter((r) => domainOf(r) === 'resend.dev' ? r.startsWith('bounced@') : then.rowsRaw('_recipient_domain').some((d) => d.id === domainOf(r) && d.rejects === true));
    if (refusing.length) await then.write(EMAIL, String(e.id), { last_event: 'bounced', _bounced_to: refusing }, 'email.bounce');
    else await then.write(EMAIL, String(e.id), { last_event: 'delivered', _delivered_at: then.occurredAt }, 'email.deliver');
  }
  for (const d of ctx.rowsRaw(DOMAIN).filter((x) => x.status === 'pending' && x.deleted !== true)) {
    const records = d.records as Row[];
    const set = records.map((r) => found(ctx, String(d.name), r));
    // source: spec:/components/schemas/Domain/properties/click_tracking "Whether click tracking is enabled for this domain."
    // A provisioned Tracking record is needed only when that feature is enabled.
    const required = records.map((r) => r.record !== 'Tracking' || d.click_tracking === true);
    if (set.every((record, i) => record || !required[i])) {
      const latest = Math.max(Date.parse(String(d._verify_at)), ...set.filter((record): record is Row => record !== undefined).map((record) => Date.parse(String(record._set_at))));
      const due = latest + 600_000;
      if (due > now) continue;
      const then = await ctx.at(new Date(due).toISOString());
      await then.write(DOMAIN, String(d.id), { status: 'verified', records: records.map((r, i) => set[i] ? { ...r, status: 'verified' } : r) }, 'domain.verified');
    } else if (at(d._verify_at, 72 * 3_600_000) <= now) await failVerification(ctx, d, records, set);
  }
}
