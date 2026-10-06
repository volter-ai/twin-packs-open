// THE CLAUDE API'S FRONT: what the API does around every request to it, one the surface names or not. It reads the key
// (./shared.ts: `Authorization: Bearer`, or the legacy `x-api-key`) and refuses a missing or dead one 401
// `authentication_error`; it refuses a request without `anthropic-version` ("you must send an `anthropic-version`
// request header"); it names the key's workspace to the handler; and every answer carries a request id (the
// `request-id` header, and `request_id` in an error the kernel answered). Where the documentation stops: the order (the
// key first), and the refusals' words, as the API answers them.
// source: https://platform.claude.com/docs/en/api/versioning "When making API requests, you must send an anthropic-version request header."
import type { HandlerContext } from '@volter/world-core';
import { liveKey, presentedKey, refuse, REQUEST_HEADER, WORKSPACE_HEADER } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  if (new URL(request.url).pathname === '/twin') return next();
  // the request's id, issued once (ctx.issue: each request's is another), carried to the handler as a header
  const id = `req_011C${await ctx.issue('_request')}`;
  const rid = { 'request-id': id };
  const presented = presentedKey(request);
  if (!presented) return refuse(ctx, 401, 'authentication_error', 'x-api-key header is required', rid);
  const key = liveKey(ctx, presented);
  if (!key) return refuse(ctx, 401, 'authentication_error', 'invalid x-api-key', rid);
  if (!request.headers.get('anthropic-version')) return refuse(ctx, 400, 'invalid_request_error', 'anthropic-version: header is required', rid);
  const headers = new Headers(request.headers);
  headers.set(WORKSPACE_HEADER, String(key.workspace));
  headers.set(REQUEST_HEADER, id);
  const answer = await next(new Request(request, { headers }));
  return answer.headers.has('request-id') ? answer : enveloped(answer, id);
}

/** Envelopes a kernel gap or another response that does not already carry the API request id. */
async function enveloped(answer: Response, id: string): Promise<Response> {
  const out = new Headers(answer.headers);
  out.set('request-id', id);
  if (answer.status >= 400 && (answer.headers.get('content-type') ?? '').includes('json')) {
    const body = (await answer.json()) as Record<string, unknown>;
    return Response.json({ ...body, request_id: id }, { status: answer.status, headers: out });
  }
  return new Response(answer.body, { status: answer.status, headers: out });
}
