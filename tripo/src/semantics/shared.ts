// What Tripo shares: the World's accounts, with API keys held by SHA-256.
import type { HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;
export const ACCOUNT = '_account';
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v);

// source: spec:/paths/~1v2~1openapi~1user~1balance/get/servers "https://api.tripo3d.ai"
// source: spec:/paths/~1v2~1openapi~1user~1balance/get/servers "https://api.tripo3d.com"
export function balanceHost(ctx: HandlerContext): boolean {
  const request = ctx.call.request;
  // World routing retains the original vendor host, as the kernel's host routing does.
  const host = (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host).toLowerCase().replace(/:\d+$/, '');
  return host === 'api.tripo3d.ai' || host === 'api.tripo3d.com';
}

// source: spec:getBalance "Get the user's account balance."
// Native key ownership selects the account whose balance is read.
export function accountOf(ctx: HandlerContext): Row | undefined {
  const key = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!key) return undefined;
  const hash = sha256(ctx, key);
  const credential = ctx.rowsRaw('_api_key').find((row) => row.revoked !== true && row.key_sha256 === hash);
  return credential ? ctx.row(ACCOUNT, String(credential.account_id)) : ctx.rowsRaw(ACCOUNT).find((row) => row.key_sha256 === hash);
}

// source: recording:gap.json "<title>404 Not Found</title>"
export function frontNotFound(): Response {
  return new Response("<html>\n<head><title>404 Not Found</title></head>\n<body>\n<center><h1>404 Not Found</h1></center>\n<hr><center>openresty/1.21.4.1</center>\n</body>\n</html>\n", { status: 404, headers: { 'content-type': 'text/html' } });
}
