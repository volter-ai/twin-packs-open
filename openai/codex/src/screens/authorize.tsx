import type { HandlerContext } from '@volter/world-core';
import { CODEX_CLIENT, codexConsent, codexError, codexRedirect } from '../semantics/shared.ts';
import { codexSignInPage } from '../../../src/screens/shared.tsx';
// source: https://developers.openai.com/codex/auth "one-time code"
export async function screen(ctx: HandlerContext): Promise<Response> {
  if (ctx.call.request.method === 'GET') { const q = new URL(ctx.call.request.url).searchParams;
    if (q.get('client_id') !== CODEX_CLIENT || q.get('response_type') !== 'code' || !codexRedirect(q.get('redirect_uri')) || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return codexError('invalid_request', 'Invalid authorization request.');
    return codexSignInPage(false, q.toString()); }
  const decision = await codexConsent(ctx, false);
  return decision instanceof Response ? decision : codexSignInPage(false, decision.query ?? '', decision.error, decision.notice);
}
