// X's OAuth 2.0 authorize screen at x.com/i/oauth2/authorize (./shared.tsx): the kernel calls `screen` for the screen and
// for the decision its form posts back to the same path.
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { originOf, send } from '../semantics/shared.ts';
import { authorizeScreen, consentDecision, errorPage, type ScreenEnv } from './shared.tsx';

async function respond(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const env: ScreenEnv = { origin: originOf(ctx), readOnly: isReadOnlyRequest(request) };
  if (request.method === 'POST') return send(await consentDecision(ctx, new URLSearchParams(ctx.text)));
  return send(await authorizeScreen(ctx, env, new URL(request.url).searchParams));
}

/** Unexpected host failure while rendering or storing consent, outside a vendor request refusal. */
function serverFailure(env: ScreenEnv): Response {
  return send(errorPage(env, { status: 500, code: 'server_error', detail: 'The authorization server could not complete the request.' }));
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const env: ScreenEnv = { origin: originOf(ctx), readOnly: isReadOnlyRequest(ctx.call.request) };
  return respond(ctx).catch(() => serverFailure(env));
}
