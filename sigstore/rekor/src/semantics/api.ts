// Rekor's API: entries appended to the transparency log, each answered with the timestamp the log signed and its proof
// of inclusion, and the log's public key, which npm's verifier reads to check those proofs. The log's other reads (its
// state, proofs, entries by UUID or index, search) are called by no application here (../../../journeys/demand.json).
import type { HandlerContext } from '@volter/world-core';
import { canonical, canonicalize, ENTRY, entries, fail, leafHash, logEntry, logKey, type Row, signed, uuidOf } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : {});

// source: spec:createLogEntry "Creates an entry in the transparency log"
export async function createLogEntry(ctx: HandlerContext): Promise<Response> {
  const kept = canonicalize(bodyOf(ctx));
  if (!kept) return fail(400, 'unsupported entry kind');
  const body = Buffer.from(canonical(kept));
  const leaf = leafHash(body);
  const id = uuidOf(leaf);
  const all = entries(ctx);
  // an entry already in the log is Rekor's conflict, naming the existing entry
  if (all.some((e) => e.id === id)) return new Response(JSON.stringify({ code: 409, message: 'An equivalent entry already exists in the transparency log with UUID ' + id }), { status: 409, headers: { 'content-type': 'application/json', location: `/api/v1/log/entries/${id}` } });
  const logIndex = all.length;
  const integratedTime = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  const b64 = body.toString('base64');
  // the signed entry timestamp: the log's signature over the entry without its verification, canonicalized
  const key = await logKey(ctx);
  const set = signed(key, canonical({ body: b64, integratedTime, logID: key.id, logIndex }));
  await ctx.record(ENTRY, { id, logIndex, integratedTime, body: b64, leaf: leaf.toString('hex'), set, kind: kept.kind }, id);
  const now = entries(ctx);
  return new Response(JSON.stringify(logEntry(key, now.find((e) => e.id === id)!, now)), { status: 201, headers: { 'content-type': 'application/json', etag: id, location: `/api/v1/log/entries/${id}` } });
}

// source: spec:getPublicKey "Returns the public key that can be used to validate the signed tree head"
export async function getPublicKey(ctx: HandlerContext): Promise<Response> {
  const key = await logKey(ctx);
  return ctx.raw(key.publicPem, { headers: { 'content-type': 'application/x-pem-file' } });
}
