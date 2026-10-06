// Emails: one sent, a batch of up to 100 sent, a sent one read, a received one read. A send is checked as Resend checks
// it (the required fields, the sender's verified domain), kept, and sent at once (`sent`, announced as email.sent);
// the recipient's server takes or refuses it moments later (./clock.ts).
import type { HandlerContext } from '@volter/world-core';
import { EMAIL, emailView, invalid, keepAttachments, list, notFound, pageOf, RECEIVED, type Row, senderRefusal, stamp, teamOf } from './shared.ts';

const bodyOf = (ctx: HandlerContext): unknown => ctx.body;

/** A send's refusal, or undefined. */
// source: https://resend.com/docs/api-reference/errors "The request body is missing one or more required fields."
function checked(ctx: HandlerContext, team: string, p: Row): Response | undefined {
  // Templates are outside this pack's served content modes; the API gap envelope is the manifest's.
  // source: spec:/components/schemas/SendEmailRequest/properties/template "Use a published template to send the email."
  if (p.template !== undefined) return ctx.refuse({ status: 404, code: 'not_found', message: 'The requested endpoint does not exist.' });
  const missing = ['from', 'to', 'subject'].filter((k) => p[k] === undefined || p[k] === '' || (Array.isArray(p[k]) && !(p[k] as unknown[]).length));
  if (missing.length) return invalid(`Missing \`${missing[0]}\` field.`, 422, 'missing_required_field');
  if (p.html === undefined && p.text === undefined) return invalid('Missing `html` or `text` field.', 422, 'missing_required_field');
  // source: spec:/components/schemas/SendEmailRequest/properties/to "Max 50."
  if (list(p.to).length > 50) return invalid('Too many recipients: `to` accepts at most 50 addresses.');
  // source: spec:/components/schemas/SendEmailRequest/properties/scheduled_at "The date should be in ISO 8601 format."
  if (p.scheduled_at !== undefined && (typeof p.scheduled_at !== 'string' || !Number.isFinite(Date.parse(p.scheduled_at)))) return invalid('Invalid `scheduled_at`: expected an ISO 8601 date.');
  if (p.attachments !== undefined && (!Array.isArray(p.attachments) || (p.attachments as Row[]).some((a) => !a || typeof a.filename !== 'string' || typeof a.content !== 'string'))) return invalid('Each attachment requires a filename and base64 content.');
  return senderRefusal(ctx, team, p.from, list(p.to));
}

/** One send kept and sent: its id, the message id Resend gives it. */
async function sendOne(ctx: HandlerContext, team: string, p: Row): Promise<string> {
  const id = ctx.mint(EMAIL);
  const now = ctx.occurredAt;
  const attachments = await keepAttachments(ctx, id, (p.attachments ?? []) as Row[]);
  await ctx.write(EMAIL, id, {
    id, object: 'email', from: p.from, to: list(p.to), cc: list(p.cc), bcc: list(p.bcc), reply_to: list(p.reply_to), subject: p.subject,
    html: typeof p.html === 'string' ? p.html : null, text: typeof p.text === 'string' ? p.text : null, tags: Array.isArray(p.tags) ? p.tags : [],
    scheduled_at: p.scheduled_at ?? null, _attachments: attachments.map(({ metadata, blob }) => ({ ...metadata, _blob: blob })), created_at: stamp(now), message_id: `<${id}@email.amazonses.com>`, last_event: 'queued',
    _team: team, _created_iso: now,
  }, 'email.create');
  if (p.scheduled_at !== undefined && Date.parse(String(p.scheduled_at)) > Date.parse(now)) return schedule(ctx, id, String(p.scheduled_at));
  const refused = ctx.legal(EMAIL, 'last_event', 'email.send', 'queued', 'sent', id, 'vendor');
  if (!refused) await ctx.write(EMAIL, id, { last_event: 'sent', _sent_at: now }, 'email.send');
  return id;
}

/** A future send waits on the vendor clock; the request's ISO date is retained. */
// source: spec:/components/schemas/SendEmailRequest/properties/scheduled_at "Schedule email to be sent later."
async function schedule(ctx: HandlerContext, id: string, at: string): Promise<string> {
  const refused = ctx.legal(EMAIL, 'last_event', 'email.schedule', 'queued', 'scheduled', id, 'vendor');
  if (!refused) await ctx.write(EMAIL, id, { last_event: 'scheduled', _scheduled_at: new Date(at).toISOString() }, 'email.schedule');
  return id;
}

/** POST /emails */
// source: spec:emails/send "Send an email"
export async function emails_send(ctx: HandlerContext): Promise<Response> {
  const p = (bodyOf(ctx) ?? {}) as Row;
  const team = teamOf(ctx);
  const refused = checked(ctx, team, p);
  if (refused) return refused;
  return Response.json({ id: await sendOne(ctx, team, p) });
}

/** POST /emails/batch: each send checked first (one refused refuses the batch), then all sent. */
// source: spec:emails/send-batch "Trigger up to 100 batch emails at once."
export async function emails_send_batch(ctx: HandlerContext): Promise<Response> {
  const sends = bodyOf(ctx);
  if (!Array.isArray(sends)) return invalid('The request body must be an array of emails.');
  if (sends.length > 100) return invalid('Too many emails: a batch sends at most 100.');
  const team = teamOf(ctx);
  for (const s of sends) { const refused = checked(ctx, team, (s ?? {}) as Row); if (refused) return refused; }
  const data: Row[] = [];
  for (const s of sends) data.push({ id: await sendOne(ctx, team, s as Row) });
  return Response.json({ data });
}

/** GET /emails: the team's sent emails, newest first, paged; each without its bodies and tags, an empty cc, bcc or
 *  reply_to answered null, as the List Emails page answers them. */
// source: spec:emails/list "Retrieve a list of emails"
// source: https://resend.com/docs/api-reference/emails/list-emails "reply_to"
export async function emails_list(ctx: HandlerContext): Promise<Response> {
  const mine = ctx.rowsRaw(EMAIL).filter((e) => e._team === teamOf(ctx) && e.deleted !== true).reverse().sort((a, b) => String(b._created_iso).localeCompare(String(a._created_iso)));
  const orNull = (v: unknown): unknown => (Array.isArray(v) && v.length ? v : null);
  return pageOf(ctx, mine.map((e) => ctx.own(e)), (e) => ({ id: e.id, message_id: e.message_id, to: e.to, from: e.from, created_at: e.created_at, subject: e.subject, bcc: orNull(e.bcc), cc: orNull(e.cc), reply_to: orNull(e.reply_to), last_event: e.last_event, scheduled_at: e.scheduled_at ?? null }));
}

/** GET /emails/{email_id} */
// source: spec:emails/get "Retrieve a single email"
export async function emails_get(ctx: HandlerContext): Promise<Response> {
  const e = ctx.rowsRaw(EMAIL).find((x) => x.id === ctx.call.params.email_id && x._team === teamOf(ctx) && x.deleted !== true);
  return e ? Response.json(emailView(ctx.own(e))) : notFound('Email');
}

/** GET /emails/receiving/{email_id}: a received email, with its raw message's pre-signed download URL (an hour). */
// source: https://resend.com/docs/api-reference/emails/retrieve-received-email "download_url"
export async function emails_get_receiving(ctx: HandlerContext): Promise<Response> {
  const row = ctx.rowsRaw(RECEIVED).find((x) => x.id === ctx.call.params.email_id && x._team === teamOf(ctx) && x.deleted !== true);
  if (!row) return notFound('Email');
  const r = ctx.own(row);
  const expires = new Date(Date.parse(ctx.occurredAt) + 3_600_000).toISOString();
  const signature = (await ctx.secret(`resend-raw:${String(r.id)}:${expires}`)).slice(0, 32);
  return Response.json({
    object: 'email', id: r.id, to: r.to, from: r.from, created_at: r.created_at, subject: r.subject, html: r.html ?? null, text: r.text ?? null,
    headers: r.headers, html_format: r.html_format, authentication: r.authentication, bcc: [], cc: [], reply_to: [], received_for: r.received_for, message_id: r.message_id,
    raw: { download_url: `https://inbound-cdn.resend.com/receiving/raw/${String(r.id)}?Expires=${encodeURIComponent(expires)}&Signature=${signature}`, expires_at: expires },
    attachments: r.attachments ?? [],
  });
}

/** Received mail enumerated for a vendor-backed refresh, in the list reference's thin view. */
// source: spec:emails/list-receiving "Retrieve a list of received emails"
export async function emails_list_receiving(ctx: HandlerContext): Promise<Response> {
  const mine = ctx.rowsRaw(RECEIVED).filter((r) => r._team === teamOf(ctx) && r.deleted !== true).reverse();
  return pageOf(ctx, mine, (r) => {
    const e = ctx.own(r);
    return { id: e.id, to: e.to, from: e.from, created_at: e.created_at, subject: e.subject, bcc: [], cc: [], reply_to: [], message_id: e.message_id, attachments: e.attachments ?? [] };
  });
}
