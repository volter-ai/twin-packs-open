import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { requestKey } from '../engine/oauth.ts';
import { credentialSandbox } from './shared.ts';

export async function tenant(ctx: HandlerContext): Promise<string> {
  const path = new URL(ctx.call.request.url).pathname;
  const body = ctx.body as Row | undefined;
  const key = requestKey(ctx.call.request);
  if (path.startsWith('/_twin/') && (path === '/_twin/app-credentials' || body?.account !== undefined || body?.deployment !== undefined)) {
    return String((await credentialSandbox(ctx))._namespace);
  }
  if (key) {
    const held = ctx.rowsRaw('_platform_key').find((row) => row._sha256 === ctx.crypto.sha256(key) && ['secret', 'publishable'].includes(String(row.kind)));
    if (held) {
      if (path.startsWith('/_twin/') && held.sandbox === undefined) await credentialSandbox(ctx);
      return held._sandbox as string;
    }
  }
  if (path.startsWith('/_twin/')) return String((await credentialSandbox(ctx))._namespace);
  const segments = path.split('/').filter(Boolean);
  const session = /^\/setup\/s\/(onbs_[A-Za-z0-9_]+)\/?$/.exec(path)?.[1];
  const row = ['checkout.session', 'billing_portal.session', 'account_link']
    .flatMap((resource) => ctx.rowsRaw(resource))
    .find((row) => typeof row.id === 'string' && segments.includes(row.id))
    ?? (session ? ctx.rowsRaw('account_link').find((row) => row._session === session) : undefined);
  return (row?._sandbox as string | undefined) ?? 'default';
}
