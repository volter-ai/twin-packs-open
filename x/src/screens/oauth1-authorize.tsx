// X's OAuth 1.0a authorize screen at api.x.com/oauth/authorize (./shared.tsx): the kernel calls `screen` for the screen and
// for the decision its form posts back (POST oauth/authorize, as X's own screen does).
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { originOf, send } from '../semantics/shared.ts';
import { oauth1Decision, oauth1Screen, type ScreenEnv } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const env: ScreenEnv = { origin: originOf(ctx), readOnly: isReadOnlyRequest(request) };
  if (request.method === 'POST') {
    const form = new URLSearchParams(ctx.text);
    return send(await oauth1Decision(ctx, env, form.get('auth_request') ?? '', form.get('decision') ?? ''));
  }
  return send(await oauth1Screen(ctx, env, 'authorize', new URL(request.url).searchParams));
}
