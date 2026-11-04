// EDGE CONFIG'S READS — edge-config.vercel.com/{id}: what @vercel/edge-config sends with the connection string's read
// token (`Authorization: Bearer <token>`): `GET /{id}/item/{key}?version=1` answers the item's value as JSON, a key the
// store does not hold 404 with the store's `x-edge-config-digest` (the SDK reads that as undefined), `HEAD` the same
// without a body, and `GET /{id}/items` every item, or those its `key` parameters name (getAll(keys))
// (@vercel/edge-config 0.4.1, dist/index.js). A token that is not the store's is 401. A content host
// (docs/contributing/architecture.md, "Screens").
// source: https://raw.githubusercontent.com/vercel/storage/main/packages/global-config/src/utils/index.ts "https://edge-config.vercel.com/<globalConfigId>?token=<token>"
import type { HandlerContext } from '@volter/world-core';
import { EDGE_CONFIG, EDGE_CONFIG_ITEM } from '../semantics/shared.ts';

const text = (status: number, body = ''): Response => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const m = /^\/(ecfg_[A-Za-z0-9]+)\/(item\/([A-Za-z0-9_-]+)|items|digest)\/?$/.exec(url.pathname);
  if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) return text(404, 'Not Found');
  const store = ctx.rowsRaw(EDGE_CONFIG).find((e) => e.id === m[1] && e.deleted !== true);
  if (!store) return text(404, 'Not Found');
  const bearer = /^bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? url.searchParams.get('token');
  if (bearer !== store._read_token) return text(401, 'Unauthorized');
  const headers = { 'content-type': 'application/json', 'x-edge-config-digest': String(store.digest) };
  const items = ctx.rowsRaw(EDGE_CONFIG_ITEM).filter((i) => i.edgeConfigId === store.id && i.deleted !== true);
  if (m[2] === 'digest') return new Response(JSON.stringify(store.digest), { status: 200, headers });
  // getAll(keys) names each key it wants (`&key=a&key=b`); with none it reads every item
  const keys = url.searchParams.getAll('key');
  const asked = keys.length ? items.filter((i) => keys.includes(String(i.key))) : items;
  if (m[2] === 'items') return new Response(request.method === 'HEAD' ? null : JSON.stringify(Object.fromEntries(asked.map((i) => [i.key, i.value]))), { status: 200, headers });
  const item = items.find((i) => i.key === m[3]);
  if (!item) return new Response(null, { status: 404, headers });
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(item.value), { status: 200, headers });
}
