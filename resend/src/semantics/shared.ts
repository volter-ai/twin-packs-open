// What Resend's front, handlers, doors and pages share: its error envelope, the key a request carries and the team it
// acts for, addresses and their domains, Resend's timestamps, a domain's records and whether it may send, and an email
// as the API answers it.
import { signedIn, type ErrorSpec, type HandlerContext } from '@volter/world-core';
import { rawMessage } from '../engine/mime.ts';

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

/** One of Resend's testing addresses (`delivered@`, `bounced@` or `complained@resend.dev`, each with an optional
 *  `+label`), by the outcome it simulates, else undefined (ADR 0032 §3). */
// source: https://resend.com/docs/dashboard/emails/send-test-emails "delivered@resend.dev"
export const testingAddress = (address: unknown): 'delivered' | 'bounced' | 'complained' | undefined =>
  /^(delivered|bounced|complained)(\+[^@\s]+)?@resend\.dev$/.exec(addressOf(address))?.[1] as 'delivered' | 'bounced' | 'complained' | undefined;

/** Whether a send's sender may send to its delivery recipients (To, Cc and Bcc): from the team's verified domain, or
 *  from Resend's testing domain to the team's own address or Resend's testing addresses, which any account may send to
 *  (ADR 0032 §3). */
// source: https://resend.com/docs/api-reference/errors "Please, add and verify your domain."
export function senderRefusal(ctx: Pick<HandlerContext, 'rowsRaw'>, team: string, from: unknown, recipients: string[]): Response | undefined {
  const domain = domainOf(from);
  if (domain === 'resend.dev') {
    const owner = ctx.rowsRaw(KEY).find((k) => k._team === team)?._owner;
    if (recipients.every((t) => addressOf(t) === owner || testingAddress(t) !== undefined)) return undefined;
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

/** A recipient's reply, as the server of their domain answered Resend's hand-off (ctx.mail). */
export type Reply = { to: string; code: number; reply: string };

/** What a reply makes of the email for that recipient (ADR 0032 §3), the one reading every send takes (a single send,
 *  each email of a batch, a released scheduled send): `2xx` delivered, `5xx` a permanent refusal (bounced), and any other
 *  reply, a `4xx` among them, temporary (RFC 5321 §4.2.1 "transient negative completion"), which leaves it undelivered
 *  (delayed). The twin retries nothing. */
export const outcome = (r: Reply): 'delivered' | 'bounced' | 'delayed' =>
  r.code >= 200 && r.code < 300 ? 'delivered' : r.code >= 500 && r.code < 600 ? 'bounced' : 'delayed';

/** Words for a header, RFC 2047's encoded word when they are not ASCII. */
const headerWords = (value: unknown): string => {
  const text = String(value ?? '');
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
};

/** The message Resend sends for a stored email: its headers (From, To, Cc, Reply-To, Subject, Date, Message-ID), its
 *  text and HTML, and its attachments' bytes, as MIME; Bcc is the envelope's alone. */
async function outbound(ctx: HandlerContext, e: Row): Promise<string> {
  const files: Array<{ metadata: Row; bytes: Uint8Array }> = [];
  for (const a of (e._attachments ?? []) as Row[]) {
    const bytes = await ctx.blobs.get(String(a._blob));
    if (bytes) files.push({ metadata: a, bytes: new Uint8Array(bytes) });
  }
  const cc = list(e.cc), replyTo = list(e.reply_to);
  const headers: Row = {
    From: e.from, To: list(e.to).join(', '), ...(cc.length ? { Cc: cc.join(', ') } : {}), ...(replyTo.length ? { 'Reply-To': replyTo.join(', ') } : {}),
    Subject: headerWords(e.subject), Date: new Date(String(e._created_iso)).toUTCString().replace(/GMT$/, '+0000'), 'Message-ID': e.message_id, 'MIME-Version': '1.0',
  };
  return rawMessage(headers, typeof e.text === 'string' ? e.text : null, typeof e.html === 'string' ? e.html : null, files, (await ctx.secret(`resend-outbound:${String(e.id)}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 24));
}

/** A sent email handed to each recipient's mailbox provider (ADR 0032 §3): its message, over SMTP through the kernel's
 *  ctx.mail, to the World's twin that receives each recipient's domain; every recipient's reply, which the clock turns
 *  into `delivered`, `bounced` or `delivery_delayed` by `outcome` (./clock.ts). Resend's testing addresses at resend.dev are its own: `bounced@` refuses,
 *  `complained@` is delivered and then complains (./clock.ts), any other accepts. */
// source: https://resend.com/docs/api-reference/errors "Please, add and verify your domain."
export async function handOn(ctx: HandlerContext, e: Row): Promise<Reply[]> {
  const recipients = [...list(e.to), ...list(e.cc), ...list(e.bcc)].map(addressOf);
  const testing = recipients.filter((r) => domainOf(r) === 'resend.dev');
  const outside = recipients.filter((r) => domainOf(r) !== 'resend.dev');
  // Where the documentation stops: the testing addresses' replies are the twin's words
  const own: Reply[] = testing.map((to) => (testingAddress(to) === 'bounced' ? { to, code: 550, reply: `550 5.1.1 <${to}>: Recipient address rejected` } : { to, code: 250, reply: '250 2.0.0 OK' }));
  const handed = outside.length ? await ctx.mail({ from: addressOf(e.from), to: outside, raw: await outbound(ctx, e) }) : [];
  return [...own, ...handed.map(({ to, code, reply }) => ({ to, code, reply }))];
}

// ---------- the dashboard's people and teams (resend.com's sign-up, sign-in and Domains page)

/** Resend's dashboard session cookie. Where the documentation stops: its name is the twin's, opaque. */
export const SESSION_COOKIE = 'resend_session';

/** A team, as the sign-up makes it: an id Resend mints, the team's identity every person, domain, key and email of it
 *  is bound to, and its label (the organization's name, which another team may share: ADR 0033 §6). */
export const TEAM = '_team';

/** The team of the person signed in to the dashboard, by its id, or undefined. */
export function signedInTeam(ctx: HandlerContext): string | undefined {
  const person = signedIn(ctx, SESSION_COOKIE);
  return typeof person?.team === 'string' ? person.team : undefined;
}

/** A team's label on the dashboard: the name its sign-up gave it, else its identity (a team the World's doors name). */
export const teamLabel = (ctx: Pick<HandlerContext, 'rowsRaw'>, team: string): string => String(ctx.rowsRaw(TEAM).find((t) => t.id === team && t.deleted !== true)?.name ?? team);

const REGIONS = ['us-east-1', 'eu-west-1', 'sa-east-1', 'ap-northeast-1'];
/** A domain as Resend answers it. */
export const domainView = (d: Row): Row => ({ object: 'domain', id: d.id, name: d.name, status: d.status, created_at: d.created_at, region: d.region, open_tracking: d.open_tracking, click_tracking: d.click_tracking, ...(d.tracking_subdomain ? { tracking_subdomain: d.tracking_subdomain } : {}), capabilities: d.capabilities, records: d.records });

/** A domain added to a team, its records to set at the owner's DNS host: the created domain as Resend answers it (201),
 *  or its refusal. */
// source: spec:domains/create "Create a new domain"
export async function createDomain(ctx: HandlerContext, team: string, p: Row): Promise<Response> {
  const name = typeof p.name === 'string' ? p.name.trim().toLowerCase() : '';
  if (!name) return invalid('Missing `name` field.', 422, 'missing_required_field');
  const region = typeof p.region === 'string' ? p.region : 'us-east-1';
  if (!REGIONS.includes(region)) return invalid(`Invalid \`region\`. Possible values are ${REGIONS.join(' | ')}.`);
  // source: https://resend.com/docs/api-reference/errors "domain has been registered already."
  if (ctx.rowsRaw(DOMAIN).some((d) => d.name === name && d.deleted !== true)) return invalid(`The ${name} domain has been registered already.`, 403);
  const caps = (p.capabilities ?? {}) as Row;
  const receiving = caps.receiving === 'enabled';
  // source: https://resend.com/docs/api-reference/domains/create-domain "tracking_subdomain"
  const tracking = typeof p.tracking_subdomain === 'string' && p.tracking_subdomain ? p.tracking_subdomain : 'links';
  const id = ctx.mint(DOMAIN);
  const dkim = (await ctx.secret(`resend-dkim:${id}`)).replace(/[-_]/g, 'A').slice(0, 172);
  // source: https://resend.com/docs/api-reference/domains/create-domain "tracking_subdomain"
  // The published default response includes the Tracking CNAME even with click_tracking false.
  const row: Row = {
    id, object: 'domain', name, status: 'not_started', created_at: stamp(ctx.occurredAt), region, open_tracking: p.open_tracking === true, click_tracking: p.click_tracking === true,
    ...(tracking ? { tracking_subdomain: tracking } : {}), capabilities: { sending: caps.sending === 'disabled' ? 'disabled' : 'enabled', receiving: receiving ? 'enabled' : 'disabled' },
    records: recordsOf(name, region, dkim, tracking, receiving), _team: team,
  };
  await ctx.write(DOMAIN, id, row, 'domain.create');
  const { object: _o, ...created } = domainView({ ...row, id });
  return Response.json(created, { status: 201 });
}

/** Resend starts checking a domain's records (pending); a verified domain stays verified. */
// source: spec:domains/verify "Verify an existing domain"
export async function verifyDomain(ctx: HandlerContext, d: Row): Promise<Response> {
  if (d.status !== 'verified') {
    const refused = ctx.legal(DOMAIN, 'status', 'domains/verify', d.status, 'pending');
    if (refused) return invalid(refused.message, refused.status);
    await ctx.write(DOMAIN, String(d.id), { status: 'pending', records: (d.records as Row[]).map((r) => ({ ...r, status: 'pending' })), _verify_at: ctx.occurredAt }, 'domain.verify');
  }
  return Response.json({ object: 'domain', id: d.id });
}
