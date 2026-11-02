// The identity service's error page: where a sign-in that failed lands.
import type { HandlerContext } from '@volter/world-core';
import { esc, page } from '../semantics/shared.ts';

/** `/error`: where a sign-in that failed lands (a provider that named no verified email, a refused grant), with why. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const error = new URL(ctx.call.request.url).searchParams.get('error') ?? 'the sign-in did not complete';
  const shown = page('Sign-in failed', `<h1>Sign-in failed</h1><p>${esc(error)}</p><p><a href="/login">Try again</a></p>`);
  return new Response(shown.body, { status: 400, headers: shown.headers });
}
