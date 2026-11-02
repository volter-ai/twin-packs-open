// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: the relay's policy, as its operator sets it, and the inspect doors a team reads delivered mail through.
import type { HandlerContext } from '@volter/world-core';
import { MESSAGE, RELAY, type Row } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const bad = (error: string, status = 400): Response => Response.json({ error }, { status });
const view = (ctx: HandlerContext, m: Row): Row => ctx.get(MESSAGE, String(m.id))!;
const live = (ctx: HandlerContext): Row[] => ctx.rowsRaw(MESSAGE).filter((m) => m.deleted !== true).reverse().sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
const messageOf = (ctx: HandlerContext): Row | undefined => ctx.rowsRaw(MESSAGE).find((m) => m.id === ctx.call.params.id && m.deleted !== true);

/** POST /_twin/relay: the relay's policy. Credentials, sender domains, relay domains and a size limit, each optional. */
export async function relay(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const auth = b.auth as Row | undefined;
  if (auth !== undefined && (typeof auth.username !== 'string' || typeof auth.password !== 'string')) return bad('auth needs a username and a password');
  for (const k of ['senderDomains', 'relayDomains', 'localRecipients']) if (b[k] !== undefined && (!Array.isArray(b[k]) || (b[k] as unknown[]).some((d) => typeof d !== 'string'))) return bad(`${k} is a list of domains`);
  if (b.maxSize !== undefined && (typeof b.maxSize !== 'number' || b.maxSize <= 0)) return bad('maxSize is a number of bytes');
  const policy: Row = {
    hostname: typeof b.hostname === 'string' ? b.hostname : 'relay.world.test', auth: auth ?? null,
    senderDomains: (b.senderDomains as string[] | undefined)?.map((d) => d.toLowerCase()) ?? null, relayDomains: (b.relayDomains as string[] | undefined)?.map((d) => d.toLowerCase()) ?? null,
    maxSize: b.maxSize ?? null, localRecipients: b.localRecipients ?? null,
  };
  await ctx.write(RELAY, 'relay', policy, 'relay.configure');
  return Response.json({ hostname: policy.hostname, auth: auth ? { username: auth.username } : null, senderDomains: policy.senderDomains, relayDomains: policy.relayDomains, maxSize: policy.maxSize, localRecipients: policy.localRecipients });
}

/** GET /_twin/messages?to=&from=&q=: the delivered messages, newest first; `q` searches the subject and the text. */
export async function messages(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const to = q.get('to')?.toLowerCase();
  const from = q.get('from')?.toLowerCase();
  const text = q.get('q')?.toLowerCase();
  const found = live(ctx).filter((m) => {
    const env = m.envelope as { from: string; to: string[] };
    return (!to || env.to.some((a) => a.toLowerCase() === to)) && (!from || env.from.toLowerCase() === from) && (!text || `${String(m.subject)}\n${String(m.text ?? '')}`.toLowerCase().includes(text));
  });
  return Response.json({ total: found.length, messages: found.map((m) => view(ctx, m)) });
}

export async function message(ctx: HandlerContext): Promise<Response> {
  const m = messageOf(ctx);
  return m ? Response.json(view(ctx, m)) : bad('no such message', 404);
}

export async function raw(ctx: HandlerContext): Promise<Response> {
  const m = messageOf(ctx);
  if (!m) return bad('no such message', 404);
  const bytes = await ctx.blobs.get(String(m._raw));
  return bytes ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'message/rfc822' } }) : bad('no such message bytes', 404);
}

export async function attachment(ctx: HandlerContext): Promise<Response> {
  const m = messageOf(ctx);
  const i = Number(ctx.call.params.index);
  const meta = (m?.attachments as Row[] | undefined)?.[i];
  const key = (m?._attachments as string[] | undefined)?.[i];
  if (!m || !meta || key === undefined) return bad('no such attachment', 404);
  const bytes = await ctx.blobs.get(key);
  if (!bytes) return bad('no such attachment bytes', 404);
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': String(meta.contentType), ...(meta.filename ? { 'content-disposition': `attachment; filename="${String(meta.filename)}"` } : {}) } });
}

export async function remove(ctx: HandlerContext): Promise<Response> {
  const m = messageOf(ctx);
  if (!m) return bad('no such message', 404);
  await ctx.remove(MESSAGE, String(m.id), 'message.delete');
  return new Response(null, { status: 204 });
}

export async function clear(ctx: HandlerContext): Promise<Response> {
  const all = live(ctx);
  for (const m of all) await ctx.remove(MESSAGE, String(m.id), 'message.delete');
  return Response.json({ deleted: all.length });
}
