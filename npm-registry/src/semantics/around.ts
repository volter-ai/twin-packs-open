// What the npm registry does around every request (docs/contributing/architecture.md, around.ts): a scoped package's path
// with its slash (`/@scope/name/-/name-1.0.0.tgz`, the form the registry mints tarball URLs in, and a client may ask a
// document or a version by; `/-/package/@scope/name/dist-tags`, the form Volter Harness reads a package's tags in) is
// answered as the encoded form every route names a package by (`@scope%2fname`).
import type { HandlerContext } from '@volter/world-core';

function scopedEncoded(request: Request): Request {
  const url = new URL(request.url);
  const scoped = /^\/(@[^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const tags = /^\/-\/package\/(@[^/]+)\/([^/]+)(\/.*)$/.exec(url.pathname);
  if (/%2f/i.test(url.pathname.split('/')[1] ?? '')) return request;
  if (tags) url.pathname = `/-/package/${tags[1]}%2f${tags[2]}${tags[3]}`;
  else if (scoped && !scoped[2]!.startsWith('-')) url.pathname = `/${scoped[1]}%2f${scoped[2]}${scoped[3] ?? ''}`;
  else return request;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(url, { method: request.method, headers: request.headers, ...(hasBody ? { body: request.body, duplex: 'half' } : {}) } as RequestInit);
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  return next(scopedEncoded(ctx.call.request));
}
