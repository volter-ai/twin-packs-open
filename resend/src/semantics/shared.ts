// What Resend's front, handlers, doors and pages share: its error envelope, the key a request carries and the team it
// acts for, addresses and their domains, Resend's timestamps, a domain's records and whether it may send, and an email
// as the API answers it.
import type { ErrorSpec, HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;

export const EMAIL = 'email';
export const DOMAIN = 'domain';
export const KEY = '_api_key';
export const RECEIVED = 'GetReceivedEmailResponse';
export const TEAM_HEADER = 'x-volter-resend-team';

/** Resend's refusal: `{ statusCode, name, message }`. */
// source: https://resend.com/docs/api-reference/errors "Missing API key in the authorization header."
export const refuse = (e: ErrorSpec): Response => Response.json({ statusCode: e.status, name: e.code ?? 'validation_error', message: e.message }, { status: e.status });
export const invalid = (message: string, status = 422, code = 'validation_error'): Response => refuse({ status, code, message });
export const notFound = (what: string): Response => refuse({ status: 404, code: 'not_found', message: `${what} not found` });

/** The team a request acts for, as the front (./around.ts) named it from the key; it overwrites whatever a client sent. */
export const teamOf = (ctx: Pick<HandlerContext, 'call'>): string => ctx.call.request.headers.get(TEAM_HEADER) ?? '';

/** An address out of `Name <a@b>` or `a@b`, lowercased. */
export function addressOf(value: unknown): string {
  const s = String(value ?? '').trim();
  return (/<([^<>]+)>\s*$/.exec(s)?.[1] ?? s).trim().toLowerCase();
}
export const domainOf = (value: unknown): string => addressOf(value).split('@')[1] ?? '';
export const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);

/** Resend's timestamps on emails and domains: `2026-04-03 22:13:42.674981+00`, as its pages answer them. */
// source: https://resend.com/docs/api-reference/emails/retrieve-email "created_at"
export const stamp = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 23)}000+00`;

/** A domain's records: DKIM at `resend._domainkey`, SPF's MX and TXT at `send` (the region's feedback host), the Tracking
 *  CNAME at its tracking subdomain, and, when it receives, the receiving MX at its root. Where the documentation stops:
 *  the DKIM key's value is drawn from the domain's own secret, and the receiving MX's value (shown on the dashboard as an
 *  image) is the region's inbound SMTP host. */
// source: https://resend.com/docs/api-reference/domains/create-domain "feedback-smtp.us-east-1.amazonses.com"
export function recordsOf(name: string, region: string, dkim: string, tracking?: string, receiving = false): Row[] {
  return [
    { record: 'DKIM', name: 'resend._domainkey', value: `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ${dkim}IDAQAB`, type: 'TXT', status: 'not_started', ttl: 'Auto' },
    { record: 'SPF', name: 'send', type: 'MX', ttl: 'Auto', status: 'not_started', value: `feedback-smtp.${region}.amazonses.com`, priority: 10 },
    { record: 'SPF', name: 'send', value: '"v=spf1 include:amazonses.com ~all"', type: 'TXT', ttl: 'Auto', status: 'not_started' },
    ...(receiving ? [{ record: 'Receiving', name, type: 'MX', value: `inbound-smtp.${region}.amazonaws.com`, ttl: 'Auto', status: 'not_started', priority: 10 }] : []),
    ...(tracking ? [{ record: 'Tracking', name: `${tracking}.${name}`, type: 'CNAME', value: 'links1.resend-dns.com', ttl: 'Auto', status: 'not_started' }] : []),
  ];
}

/** The team's verified domain a sender's address is at, if any. */
export const sendingDomain = (ctx: Pick<HandlerContext, 'rowsRaw'>, team: string, from: unknown): Row | undefined =>
  ctx.rowsRaw(DOMAIN).find((d) => d._team === team && d.name === domainOf(from) && d.status === 'verified' && d.deleted !== true);

/** Whether a send's sender may send: from the team's verified domain, or from Resend's testing domain to the team's own
 *  address only. */
// source: https://resend.com/docs/api-reference/errors "Please, add and verify your domain."
export function senderRefusal(ctx: Pick<HandlerContext, 'rowsRaw'>, team: string, from: unknown, to: string[]): Response | undefined {
  const domain = domainOf(from);
  if (domain === 'resend.dev') {
    const owner = ctx.rowsRaw(KEY).find((k) => k._team === team)?._owner;
    if (to.every((t) => addressOf(t) === owner)) return undefined;
    return invalid(`You can only send testing emails to your own email address (${String(owner)}). To send emails to other recipients, please verify a domain at resend.com/domains, and change the \`from\` address to an email using this domain.`, 403);
  }
  const sending = sendingDomain(ctx, team, from);
  // source: spec:/components/schemas/DomainCapabilities/properties/sending "Enable or disable sending emails from this domain."
  if (sending && (sending.capabilities as Row)?.sending === 'disabled') return invalid(`Sending is disabled for the ${domain} domain.`, 403);
  // Where the documentation stops: the disabled-capability wording above uses the documented 403 validation_error class.
  if (!sending) return invalid(`The ${domain} domain is not verified. Please, add and verify your domain.`, 403);
  return undefined;
}

/** An email as Resend answers it: its fields, bookkeeping left out. */
export const emailView = (e: Row): Row => ({
  object: 'email', id: e.id, to: e.to, from: e.from, created_at: e.created_at, subject: e.subject, html: e.html ?? null, text: e.text ?? null,
  bcc: e.bcc ?? [], cc: e.cc ?? [], reply_to: e.reply_to ?? [], last_event: e.last_event, scheduled_at: e.scheduled_at ?? null, tags: e.tags ?? [], message_id: e.message_id,
});

/** A list as Resend pages it: newest first, `limit` (1 to 100, 20 when not given), `after` or `before` an item's id,
 *  `has_more` when items lie beyond the page; a limit out of range, or both cursors, refused. Each item shown by `view`. Where the documentation stops: the refusals' words are the twin's,
 *  in Resend's validation_error. */
// source: spec:/components/parameters/PaginationLimit "Number of items to return."
// source: spec:/components/parameters/PaginationAfter "Return items after this cursor."
// source: spec:/components/parameters/PaginationBefore "Return items before this cursor."
export function pageOf(ctx: Pick<HandlerContext, 'call'>, newestFirst: Row[], view: (r: Row) => Row): Response {
  const q = new URL(ctx.call.request.url).searchParams;
  const asked = q.get('limit');
  const limit = asked === null ? 20 : Number(asked);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return invalid('The `limit` parameter must be an integer between 1 and 100.');
  const after = q.get('after');
  const before = q.get('before');
  if (after && before) return invalid('You can only use either `after` or `before`, not both.');
  let from = 0;
  let to = newestFirst.length;
  if (after) from = newestFirst.findIndex((r) => r.id === after) + 1;
  if (before) { to = Math.max(0, newestFirst.findIndex((r) => r.id === before)); from = Math.max(0, to - limit); }
  const items = before ? newestFirst.slice(from, to) : newestFirst.slice(from, from + limit);
  const more = before ? from > 0 : from + limit < newestFirst.length;
  return Response.json({ object: 'list', has_more: more, data: items.map(view) });
}

/** Keep attachment bytes once; email rows and the incoming MIME retain metadata and blob references only. */
// source: spec:/components/schemas/Attachment/properties/content "Content of an attached file."
export async function keepAttachments(ctx: HandlerContext, email: string, input: Row[]): Promise<Array<{ metadata: Row; bytes: Uint8Array; blob: string }>> {
  const files: Array<{ metadata: Row; bytes: Uint8Array; blob: string }> = [];
  for (const item of input) {
    const id = ctx.mint('_attachment_id');
    const bytes = new Uint8Array(Buffer.from(String(item.content), 'base64'));
    const metadata = { id, filename: item.filename, content_type: item.content_type ?? ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', csv: 'text/csv' } as Record<string, string>)[String(item.filename).split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream', content_disposition: item.content_disposition ?? 'attachment', content_id: item.content_id ?? null, size: bytes.length };
    const blob = `attachments/${email}/${id}`;
    await ctx.record('_attachment_id', { _email: email }, id);
    await ctx.blobs.put(blob, bytes);
    files.push({ metadata, bytes, blob });
  }
  return files;
}
