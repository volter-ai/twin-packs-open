import type { HandlerContext } from '@volter/world-core';
import { fail, settings } from './shared.ts';
// source: recording:worker-source.txt "Clerk Frontend API proxy is unavailable."
export async function clerkFrontendApiProxy(ctx: HandlerContext): Promise<Response> {
  const config = settings(ctx); if (!config.clerkKey) return fail(503, 'Clerk Frontend API proxy is not configured.');
  try {
    const url = new URL(ctx.call.request.url);
    const target = `https://frontend-api.clerk.dev${url.pathname.slice('/__clerk'.length) || '/'}${url.search}`;
    // source: recording:worker-source.txt "proxyRequest.headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '');"
    const headers = new Headers(ctx.call.request.headers);
    headers.set('Clerk-Proxy-Url', 'https://auth.videogame.ai/__clerk'); headers.set('Clerk-Secret-Key', config.clerkKey);
    headers.set('X-Forwarded-For', ctx.call.request.headers.get('CF-Connecting-IP') ?? '');
    // source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
    const request = ctx.call.request;
    const body = request.body === null ? undefined : await request.clone().arrayBuffer();
    // source: recording:worker-source.txt "return hardenResponse(await fetch(proxyRequest, { redirect: 'manual' }));"
    return await ctx.vendorFetch(target, { method: request.method, body, headers, signal: request.signal, redirect: 'manual' });
  } catch { return fail(502, 'Clerk Frontend API proxy is unavailable.'); }
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyPost(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyPut(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyPatch(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyDelete(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyHead(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyOptions(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}

// source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
export async function clerkFrontendApiProxyTrace(ctx: HandlerContext): Promise<Response> {
  return clerkFrontendApiProxy(ctx);
}
