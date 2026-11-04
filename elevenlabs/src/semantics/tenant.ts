import type { HandlerContext } from '@volter/world-core';
import { accountFor } from './shared.ts';

export async function tenant(ctx: HandlerContext): Promise<string | undefined> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const body = ctx.body as Record<string, unknown> | undefined;
  if (url.pathname === '/_twin/app-credentials' || (url.pathname.startsWith('/_twin/') && (body?.account !== undefined || body?.deployment !== undefined))) {
    const owner = await accountFor(ctx);
    return await ctx.account() === 'default' ? 'default' : String(owner.id);
  }
  const value = request.headers.get('xi-api-key');
  if (value) {
    const key = ctx.rowsRaw('_api_key').find((row) => row.sha256 === ctx.crypto.sha256(value));
    return typeof key?._tenant_scope === 'string' ? key._tenant_scope : undefined;
  }
  const signature = url.searchParams.get('conversation_signature');
  if (signature) {
    const held = ctx.rowsRaw('_conversation_signature').find((row) => row.sha256 === ctx.crypto.sha256(signature));
    return typeof held?._tenant_scope === 'string' ? held._tenant_scope : undefined;
  }
  const voiceId = /^\/v1\/text-to-speech\/([^/]+)\/stream-input$/.exec(url.pathname)?.[1];
  const voice = voiceId ? ctx.rowsRaw('voice').find((row) => row.id === voiceId) : undefined;
  if (typeof voice?._tenant_scope === 'string') return voice._tenant_scope;
  const agent = ctx.rowsRaw('agent').find((row) => row.id === url.searchParams.get('agent_id'));
  if (typeof agent?._tenant_scope === 'string') return agent._tenant_scope;
  return url.pathname.startsWith('/_twin/') ? 'default' : undefined;
}
