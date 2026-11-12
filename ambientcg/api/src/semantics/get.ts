import type { HandlerContext } from '@volter/world-core';
import { DOWNLOAD_HOST, FILE, fileUrl } from './shared.ts';

// Where the documentation stops: the page names no /get; a download is a 302 to the file on the download host, and a
// file no asset has is the host's text (spec/SOURCE.md)
// source: spec:getDownload "A download: a redirect to the file on the download host."
export async function getDownload(ctx: HandlerContext): Promise<Response> {
  const file = new URL(ctx.call.request.url).searchParams.get('file') ?? '';
  const f = ctx.rowsRaw(FILE).find((x) => x.deleted !== true && String(x.name).startsWith('download/') && String(x.name).endsWith(`/${file}`));
  // source: spec:getDownload "This download could not be found."
  if (!file || !f) return new Response('This download could not be found.', { status: 404, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  return new Response(null, { status: 302, headers: { location: fileUrl(DOWNLOAD_HOST, String(f.name)) } });
}
