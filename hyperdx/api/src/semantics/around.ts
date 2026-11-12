// What HyperDX's API does around every request (architecture, around.ts): Express reads a JSON body before any router,
// so a body labelled JSON that does not parse is refused 400 before the key is checked or a route is found, with the
// API error handler's `{ message }`.
import type { HandlerContext } from '@volter/world-core';
import { message } from './shared.ts';

// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/api-app.ts "app.use(express.json({ limit: '32mb', verify: captureProxyBody }));"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/middleware/error.ts "? 'Invalid JSON payload'"
// Express's JSON parser reads a body whose type is application/json, strictly: an object or an array.
// source: https://raw.githubusercontent.com/expressjs/body-parser/1.20.6/lib/types/json.js "throw createStrictSyntaxError(body, first)"
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const type = (ctx.call.request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const text = ctx.text.trim();
  if (type === 'application/json' && text !== '' && (!/^[{[]/.test(text) || !parses(text))) return message(400, 'Invalid JSON payload');
  return next();
}

const parses = (text: string): boolean => {
  try { JSON.parse(text); return true; } catch { return false; }
};
