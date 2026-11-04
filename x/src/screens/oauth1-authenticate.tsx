// X's OAuth 1.0a authenticate screen at api.x.com/oauth/authenticate (./shared.tsx): the kernel calls `screen` for the screen and
// for the decision its form posts back (POST oauth/authorize, as X's own screen does).
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { originOf, send } from '../semantics/shared.ts';
import { oauth1Screen, type ScreenEnv } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const env: ScreenEnv = { origin: originOf(ctx), readOnly: isReadOnlyRequest(request) };

  return send(await oauth1Screen(ctx, env, 'authenticate', new URL(request.url).searchParams));
}
