// The World's door (docs/contributing/architecture.md, "Doors, screens and the gap"), declared in the manifest's `doors`:
// the relay's policy, as its operator sets it.
import type { HandlerContext } from '@volter/world-core';
import { RELAY, type Row } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const bad = (error: string, status = 400): Response => Response.json({ error }, { status });

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
