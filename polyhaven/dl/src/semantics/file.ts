import type { HandlerContext } from '@volter/world-core';
import { BUCKET, FILE } from './shared.ts';

// source: spec:downloadFileByName "Downloads one file using a bucket name and file name"
export async function downloadFileByName(ctx: HandlerContext): Promise<Response> {
  const name = String(ctx.call.params.fileName);
  const f = String(ctx.call.params.bucket) === BUCKET ? ctx.row(FILE, name) : undefined;
  // source: spec:downloadFileByName "File with such name does not exist."
  if (!f || f.deleted === true) return Response.json({ code: 'not_found', message: 'File with such name does not exist.', status: 404 }, { status: 404 });
  const body = await ctx.blobs.get(name);
  if (!body) return Response.json({ code: 'not_found', message: 'File with such name does not exist.', status: 404 }, { status: 404 });
  // source: spec:downloadFileByName "The response contains the headers Content-Length, Content-Type, X-Bz-File-Name and X-Bz-Content-Sha1."
  return new Response(new Uint8Array(body).buffer, {
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length), 'x-bz-file-name': name, 'x-bz-content-sha1': String(f._sha1) },
  });
}

