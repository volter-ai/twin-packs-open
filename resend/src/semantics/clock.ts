// Resend's own moves as the World clock passes (docs/contributing/architecture.md, clock.ts):
// - a sent email was handed to its recipients' mailbox providers when it was sent (shared.ts handOn, ADR 0032 §3); five
//   seconds after, each recipient's reply decides that recipient's event: a 2xx email.delivered, a 5xx (an address with
//   no account, a domain no twin in the World receives; Resend's bounced@resend.dev always refuses) email.bounced, a 4xx
//   (one whose connection could not be opened) email.delivery_delayed, several from one send. The email's state moves
//   once, from all of them: delivery_delayed while any recipient is delayed (not final; the twin retries nothing),
//   bounced when every recipient refused, else delivered; the write that moves it is its last event;
// - a scheduled send is released at its time and handed on then;
// - a pending domain is verified once every record is at the owner's DNS host ("will often verify within 15 minutes of
//   adding the DNS records": ten minutes after the later of the verify and the last record), and fails when they are
//   not all there 72 hours after it was verified ("Resend was unable to detect the DNS records within 72 hours").
// Where the documentation stops: the five seconds and the ten minutes are the twin's.
// source: https://resend.com/docs/add-a-domain "your domain will often verify within 15 minutes of adding the DNS records"
import type { HandlerContext } from '@volter/world-core';
import { DOMAIN, EMAIL, handOn, outcome, type Reply, type Row } from './shared.ts';

const at = (iso: unknown, ms: number): number => Date.parse(String(iso)) + ms;

/** The owner's record for one of a domain's records, when it is set as asked. */
function found(ctx: HandlerContext, domain: string, r: Row): Row | undefined {
  const name = String(r.name);
  const fqdn = name === domain || name.endsWith(`.${domain}`) ? name : `${name}.${domain}`;
  const strip = (v: unknown): string => String(v ?? '').replace(/^"|"$/g, '').replace(/\.$/, '');
  return ctx.rowsRaw('_dns').find((d) => d.name === fqdn && ctx.own(d).type === r.type && strip(d.value) === strip(r.value) && d.deleted !== true);
}

/** Verification times out when the owner has not installed every required record. */
// source: https://resend.com/docs/dashboard/domains/manage-domains "Resend was unable to detect the DNS records within 72 hours."
async function failVerification(ctx: HandlerContext, d: Row, records: Row[], set: Array<Row | undefined>): Promise<void> {
  const then = await ctx.at(new Date(at(d._verify_at, 72 * 3_600_000)).toISOString());
  if (then.legal(DOMAIN, 'status', 'domain.failed', 'pending', 'failed', String(d.id), 'time')) return;
  await then.write(DOMAIN, String(d.id), { status: 'failed', records: records.map((r, i) => ({ ...r, status: set[i] ? 'verified' : 'failed' })) }, 'domain.failed');
}

/** The scheduled timestamp releases a send, after which its ordinary delivery clock applies. */
// source: spec:/components/schemas/SendEmailRequest/properties/scheduled_at "Schedule email to be sent later."
async function releaseScheduled(ctx: HandlerContext, e: Row): Promise<void> {
  const then = await ctx.at(String(e._scheduled_at));
  if (then.legal(EMAIL, 'last_event', 'email.release', 'scheduled', 'queued', String(e.id), 'time')) return;
  await then.write(EMAIL, String(e.id), { last_event: 'queued' }, 'email.release');
  if (then.legal(EMAIL, 'last_event', 'email.send', 'queued', 'sent', String(e.id), 'vendor')) return;
  await then.write(EMAIL, String(e.id), { last_event: 'sent', _sent_at: then.occurredAt, _replies: await handOn(then, e) }, 'email.send');
}

export async function clock(ctx: HandlerContext): Promise<void> {
  const now = Date.parse(ctx.occurredAt);
  for (const e of ctx.rowsRaw(EMAIL).filter((x) => x.last_event === 'scheduled' && Date.parse(String(x._scheduled_at)) <= now)) await releaseScheduled(ctx, e);
  for (const e of ctx.rowsRaw(EMAIL).filter((x) => x.last_event === 'sent' && x.deleted !== true)) {
    const due = at(e._sent_at, 5_000);
    if (due > now) continue;
    const then = await ctx.at(new Date(due).toISOString());
    const replies = (e._replies ?? []) as Reply[];
    const of = (kind: ReturnType<typeof outcome>): string[] => replies.filter((r) => outcome(r) === kind).map((r) => r.to);
    const refusing = of('bounced'), delayed = of('delayed'), delivered = of('delivered');
    const state = delayed.length ? 'delivery_delayed' : refusing.length && !delivered.length ? 'bounced' : 'delivered';
    // each recipient class announced once, the one that moves the state last
    const announcements = [
      { state: 'bounced', to: refusing, fields: { _bounced_to: refusing }, operation: 'email.bounce' },
      { state: 'delivered', to: delivered, fields: { _delivered_to: delivered, _delivered_at: then.occurredAt }, operation: 'email.deliver' },
      { state: 'delivery_delayed', to: delayed, fields: { _delayed_to: delayed }, operation: 'email.delay' },
    ].filter((a) => a.to.length).sort((a, b) => Number(a.state === state) - Number(b.state === state));
    for (const a of announcements) await then.write(EMAIL, String(e.id), a.state === state ? { last_event: state, ...a.fields } : a.fields, a.operation);
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
      if (then.legal(DOMAIN, 'status', 'domain.verified', 'pending', 'verified', String(d.id), 'time')) continue;
      await then.write(DOMAIN, String(d.id), { status: 'verified', records: records.map((r, i) => set[i] ? { ...r, status: 'verified' } : r) }, 'domain.verified');
    } else if (at(d._verify_at, 72 * 3_600_000) <= now) await failVerification(ctx, d, records, set);
  }
}
