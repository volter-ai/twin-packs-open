import type { HandlerContext } from '@volter/world-core';
import { CODEX_CLIENT, codexConsent, codexError, codexRedirect } from '../semantics/shared.ts';
import { codexSignInPage } from '../../../src/screens/shared.tsx';
// source: https://developers.openai.com/codex/auth "one-time code"
export async function screen(ctx: HandlerContext): Promise<Response> {
  if (ctx.call.request.method === 'GET') { return codexSignInPage(true, ''); }
  const decision = await codexConsent(ctx, true);
  return decision instanceof Response ? decision : codexSignInPage(true, decision.query ?? '', decision.error, decision.notice);
}
