// OpenAI file uploads retain bytes in the World's blob store.
import type { HandlerContext } from '@volter/world-core';
import { epoch, expiresAt, invalid, timeline } from './shared.ts';
// source: spec:createFile "Upload a file"
export async function createFile(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  const p = ctx.params, file = p.file as { name?: string; content?: string; bytes?: Uint8Array } | undefined;
  if (!p.purpose) return invalid(ctx, 'you must provide a purpose parameter', 'purpose');
  if (!file) return invalid(ctx, 'you must provide a file parameter', 'file');
  const bytes = file.bytes ? file.bytes : new TextEncoder().encode(file.content ?? '');
  const after = p.expires_after ?? (p['expires_after[anchor]'] === undefined ? undefined : { anchor: p['expires_after[anchor]'], seconds: p['expires_after[seconds]'] });
  const expires = expiresAt(String(p.purpose), epoch(ctx), after);
  if (expires === undefined) return invalid(ctx, "'expires_after' must have anchor 'created_at' and seconds between 3600 and 2592000", 'expires_after');
  const row = await ctx.create('OpenAIFile', { object: 'file', bytes: bytes.length, created_at: epoch(ctx), expires_at: expires, filename: file.name ?? 'upload', purpose: String(p.purpose), status: 'processed' }, 'file.create');
  await ctx.blobs.put(String(row.id), bytes);
  return ctx.reply(row);
}
// source: spec:downloadFile "Returns a response containing the contents of the specified file."
export async function downloadFile(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  const id = String(ctx.id); if (!ctx.get('OpenAIFile', id)) return ctx.notFound('OpenAIFile', id);
  const bytes = await ctx.blobs.get(id);
  if (!bytes) return contentsNotHeld(ctx, id);
  return ctx.raw(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream' } });
}
/** A file the World knows from a vendor-backed refresh (its metadata read back from the account) and whose bytes it does
 *  not hold. Where the documentation stops: OpenAI holds every file's contents, so it documents no such answer; the twin
 *  answers the file's not-found refusal, the vendor's error for a file it cannot give. */
function contentsNotHeld(ctx: HandlerContext, id: string): Response {
  return ctx.notFound('OpenAIFile', id);
}
