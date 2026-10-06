// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: what the dashboard makes (keys, webhook endpoints), what the world outside Resend does (a DNS
// host's records, a recipient server that refuses mail, a recipient who opens or complains, mail sent to a receiving
// domain), and what the World reads back (an inbox, the webhooks sent).
import { rawMessage } from '../engine/mime.ts';
import type { HandlerContext } from '@volter/world-core';
import { addressOf, DOMAIN, domainOf, EMAIL, KEY, keepAttachments, list, RECEIVED, type Row, stamp } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const bad = (error: string, status = 400): Response => Response.json({ error }, { status });

/** POST /_twin/api-keys {name, team, owner}: a full-access key made on the API Keys page, shown once ("re_…"); `team` is
 *  the account it belongs to, `owner` the address Resend's testing domain may send to. */
// source: https://resend.com/docs/api-reference/introduction "re_xxxxxxxxx"
/** A key's token, `re_` and characters drawn from secrets the World holds for its id. */
const keyToken = async (ctx: HandlerContext, id: string): Promise<string> =>
  `re_${(await ctx.secret(`resend-key:${id}`)).replace(/[-_]/g, '').slice(0, 8)}_${(await ctx.secret(`resend-key-2:${id}`)).replace(/[-_]/g, '').slice(0, 24)}`;

async function makeKey(ctx: HandlerContext, name: string, team: string, owner: string): Promise<{ id: string; token: string }> {
  const id = ctx.mint(KEY);
  const token = await keyToken(ctx, id);
  await ctx.write(KEY, id, { name, _team: team, _owner: addressOf(owner), _sha256: ctx.crypto.sha256(token), created_at: stamp(ctx.occurredAt), status: 'active', deleted: false }, 'api_key.create');
  return { id, token };
}

export async function keys(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.name !== 'string' || typeof b.team !== 'string' || typeof b.owner !== 'string') return bad('a name, a team and its owner\'s email are required');
  return Response.json(await makeKey(ctx, b.name, b.team, b.owner), { status: 201 });
}

/** POST /_twin/app-credentials: the key the World's application holds (the descriptor's credentialDoor), of the team
 *  "World": made the first time the runtime asks and the same at every boot after. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  // a held key answers again only while its value still matches what is stored (a branch that made its own seed before
  // the key reached it derives another value, so it issues a new key rather than one that is refused)
  const held = ctx.rowsRaw(KEY).find((k) => k.name === 'world' && k._team === 'World' && k.status === 'active' && k.deleted !== true);
  const again = held ? await keyToken(ctx, String(held.id)) : undefined;
  return Response.json(held && again && held._sha256 === ctx.crypto.sha256(again) ? { id: held.id, token: again } : await makeKey(ctx, 'world', 'World', 'owner@world.test'), { status: 201 });
}

/** DELETE /_twin/api-keys/{id}: a key deleted on the API Keys page. */
export async function removeKey(ctx: HandlerContext): Promise<Response> {
  const k = ctx.rowsRaw(KEY).find((x) => x.id === ctx.call.params.id && x.status === 'active');
  if (!k) return bad('no such key', 404);
  const refused = ctx.legal(KEY, 'status', 'api_key.delete', 'active', 'deleted', String(k.id), 'external');
  if (refused) return bad(refused.message, 422);
  await ctx.write(KEY, String(k.id), { status: 'deleted' }, 'api_key.delete');
  return new Response(null, { status: 204 });
}

/** POST /_twin/webhooks {team, endpoint, events}: an endpoint added on the Webhooks page; its signing secret (whsec_…). */
// source: spec:/components/schemas/GetWebhookResponse/properties/signing_secret "The secret key used to verify webhook payloads."
export async function webhooks(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.endpoint !== 'string' || !/^https?:\/\//.test(b.endpoint) || typeof b.team !== 'string') return bad('a team and an endpoint URL are required');
  const id = ctx.mint('_webhook');
  const secret = `whsec_${Buffer.from((await ctx.secret(`resend-webhook:${id}`)).slice(0, 32)).toString('base64')}`;
  await ctx.record('_webhook', { endpoint: b.endpoint, events: list(b.events), _team: b.team, signing_secret: secret, status: 'enabled', created_at: ctx.occurredAt }, id);
  return Response.json({ id, signing_secret: secret }, { status: 201 });
}

/** POST /_twin/dns {name, type, value}: a record the domain's owner sets at their DNS host. */
export async function dns(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.name !== 'string' || typeof b.type !== 'string' || typeof b.value !== 'string') return bad('a name, a type and a value are required');
  const name = b.name.toLowerCase().replace(/\.$/, '');
  await ctx.record('_dns', { name, type: b.type.toUpperCase(), value: b.value, _set_at: ctx.occurredAt, deleted: false }, `${name}:${b.type.toUpperCase()}:${ctx.crypto.sha256(b.value).slice(0, 12)}`);
  return Response.json({ name, type: b.type.toUpperCase() }, { status: 201 });
}

/** POST /_twin/recipients/{domain} {rejects}: whether an outside mail server refuses mail for its domain. */
export async function recipients(ctx: HandlerContext): Promise<Response> {
  const domain = String(ctx.call.params.domain).toLowerCase();
  await ctx.record('_recipient_domain', { rejects: bodyOf(ctx).rejects === true }, domain);
  return Response.json({ domain, rejects: bodyOf(ctx).rejects === true });
}

async function recipientMove(ctx: HandlerContext, to: 'opened' | 'complained', operation: string): Promise<Response> {
  const e = ctx.rowsRaw(EMAIL).find((x) => x.id === ctx.call.params.email_id && x.deleted !== true);
  const who = addressOf(bodyOf(ctx).to);
  if (!e || !(e.to as string[]).map(addressOf).includes(who)) return bad('no such email to that recipient', 404);
  // an open is tracked only on a domain with open tracking on
  // source: https://resend.com/docs/dashboard/domains/tracking "Open and click tracking is disabled by default"
  if (to === 'opened') {
    const domain = ctx.rowsRaw(DOMAIN).find((d) => d._team === e._team && d.name === domainOf(e.from) && d.deleted !== true);
    if (domain?.open_tracking !== true) return Response.json({ tracked: false });
  }
  const refused = ctx.legal(EMAIL, 'last_event', operation, e.last_event, to, String(e.id), 'external');
  if (refused) return bad(refused.message, 422);
  await ctx.write(EMAIL, String(e.id), { last_event: to, ...(to === 'opened' ? { _opened_by: who } : { _complained_by: who }) }, operation);
  return Response.json({ tracked: true, last_event: to });
}
/** POST /_twin/mail/{email_id}/open {to}: the recipient opens it. */
export async function open(ctx: HandlerContext): Promise<Response> {
  return recipientMove(ctx, 'opened', 'email.open');
}

/** POST /_twin/mail/{email_id}/complain {to}: the recipient marks it as spam. */
export async function complain(ctx: HandlerContext): Promise<Response> {
  return recipientMove(ctx, 'complained', 'email.complain');
}

/** POST /_twin/inbound {from, to, subject, text, html?, inReplyTo?}: mail sent from outside to an address at a verified
 *  domain that receives. */
export async function inbound(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const to = list(b.to).map(addressOf);
  const domain = ctx.rowsRaw(DOMAIN).find((d) => d.name === domainOf(to[0]) && d.status === 'verified' && (d.capabilities as Row)?.receiving === 'enabled' && d.deleted !== true);
  if (!domain || typeof b.from !== 'string' || typeof b.subject !== 'string') return bad('mail to an address at a verified receiving domain, with a sender and a subject, is required', 422);
  const id = ctx.mint(RECEIVED);
  const messageId = `<${ctx.crypto.uuidFrom(`inbound:${id}`)}@${domainOf(b.from)}>`;
  const headers: Row = { ...(b.headers && typeof b.headers === 'object' ? b.headers as Row : {}), from: b.from, to: to.join(', '), subject: b.subject, 'message-id': messageId, 'mime-version': '1.0', received: (b.headers as Row | undefined)?.received ?? `from ${domainOf(b.from)} by inbound.resend.com for <${to[0]}>`, ...(typeof b.inReplyTo === 'string' ? { 'in-reply-to': b.inReplyTo, references: b.inReplyTo } : {}) };
  // source: spec:/components/schemas/GetReceivedEmailResponse/properties/attachments "Array of attachments."
  const attachmentInput = (Array.isArray(b.attachments) ? b.attachments : []) as Row[];
  if (attachmentInput.some((a) => typeof a.filename !== 'string' || typeof a.content !== 'string')) return bad('each incoming attachment needs a filename and base64 content', 422);
  const files = await keepAttachments(ctx, id, attachmentInput);
  const attachments = files.map((f) => f.metadata);
  // source: https://resend.com/docs/api-reference/emails/retrieve-received-email "download_url"
  const raw = rawMessage(headers, typeof b.text === 'string' ? b.text : null, typeof b.html === 'string' ? b.html : null, files, (await ctx.secret(`resend-mime:${id}`)).slice(0, 24));
  await ctx.blobs.put(`raw/${id}`, new TextEncoder().encode(raw));
  // source: https://resend.com/docs/api-reference/emails/retrieve-received-email "authentication"
  // source: spec:/components/schemas/GetReceivedEmailResponse/properties/received_for "Received"
  const receivedFor = b.received_for === undefined ? [(/for\s+<?([^<>;\s]+@[^<>;\s]+)>?/i.exec(String(headers.received ?? ''))?.[1] ?? to[0])] : list(b.received_for);
  await ctx.write(RECEIVED, id, { id, attachments, received_for: receivedFor, object: 'email', html_format: 'data_uri', authentication: b.authentication ?? { spf: 'none', dkim: 'none', dmarc: 'none' }, from: b.from, to, subject: b.subject, text: b.text ?? null, html: b.html ?? null, headers, message_id: messageId, created_at: ctx.occurredAt, _raw_blob: `raw/${id}`, _team: domain._team }, 'email.receive');
  return Response.json({ id }, { status: 201 });
}

/** GET /_twin/mail?to=<address>: the emails delivered to that inbox, newest first. */
export async function mail(ctx: HandlerContext): Promise<Response> {
  const to = addressOf(new URL(ctx.call.request.url).searchParams.get('to'));
  const got = ctx.rowsRaw(EMAIL).filter((e) => ['delivered', 'opened', 'clicked', 'complained'].includes(String(e.last_event)) && [...(e.to as string[]), ...((e.cc as string[]) ?? []), ...((e.bcc as string[]) ?? [])].map(addressOf).includes(to))
    .sort((a, b) => String(b._created_iso).localeCompare(String(a._created_iso)));
  return Response.json({ mail: got.map((e) => ({ id: e.id, from: e.from, subject: e.subject, html: e.html, text: e.text, received_at: e._delivered_at, attachments: ((e._attachments ?? []) as Row[]).map(({ _blob, ...metadata }) => metadata) })) });
}

/** GET /_twin/deliveries?to=<url>[&type=<event>][&email=<id>]: the webhooks Resend sent there, oldest first, of one
 *  type or about one email when named. */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const to = q.get('to') ?? '';
  const type = q.get('type');
  const email = q.get('email');
  const sent = ctx.rowsRaw('_webhook_delivery').filter((d) => String(d.url ?? '').startsWith(to)).map((d) => {
    let body: unknown = d.body;
    try { body = JSON.parse(String(d.body)); } catch { /* as sent */ }
    return { url: d.url, headers: d.headers, body: body as Row, status: d.status };
  }).filter((d) => (!type || d.body?.type === type) && (!email || (d.body?.data as Row | undefined)?.email_id === email));
  return Response.json({ deliveries: sent });
}
