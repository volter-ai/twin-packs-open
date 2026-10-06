// SLACK'S UPLOAD ADDRESS — files.slack.com/upload/v1/<file>/<secret>, the `upload_url` files.getUploadURLExternal
// answers: "Upload the file to the upload_url with a POST request", its body the file's bytes (raw, or a multipart
// form's `filename` part), answered `OK - <length>`
// (https://docs.slack.dev/messaging/working-with-files#uploading_files). The file is then completed with
// files.completeUploadExternal. A content host (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { imageSize } from '../engine/image.ts';

const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const m = /^\/upload\/v1\/([A-Za-z0-9]+)\/([0-9a-f]+)\/?$/.exec(new URL(ctx.call.request.url).pathname);
  if (!m || ctx.call.request.method !== 'POST') return text(404, 'not_found');
  const file = ctx.row('file', m[1]!);
  if (!file || file._upload !== m[2] || file._complete === true) return text(404, 'not_found');
  const parts = await ctx.parts();
  const bytes = parts.length ? parts.find((p) => p.filename !== null)?.body ?? parts[0]!.body : new Uint8Array(await ctx.call.request.clone().arrayBuffer());
  const sha = ctx.crypto.digest('sha256', bytes, 'hex');
  await ctx.blobs.put(`files/${sha}`, bytes);
  const size = imageSize(bytes);
  await ctx.write('file', m[1]!, { _received: true, _sha256: sha, size: bytes.byteLength, ...(size ? { original_w: size.w, original_h: size.h } : {}) }, 'file.upload');
  return text(200, `OK - ${bytes.byteLength}`);
}
