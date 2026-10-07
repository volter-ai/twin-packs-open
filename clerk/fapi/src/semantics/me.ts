import type { HandlerContext } from '@volter/world-core';
import { oauthAuthorize, oauthParams } from './shared.ts';

// source: spec:submitOAuthConsent "re-submit the standard OAuth2 authorize parameters from the original"
export async function submitOAuthConsent(ctx: HandlerContext): Promise<Response> {
  const q = oauthParams(ctx);
  q.set('client_id', String(ctx.params.client_id));
  return oauthAuthorize(ctx, q, q.get('consented') === 'true');
}
