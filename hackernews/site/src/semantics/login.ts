// POST /login: the login page's two forms, 'login' and 'create account', posting to the page's own address with the
// page to return to in its query (../../spec/openapi.json, written from the page as a person sees it).
import type { HandlerContext } from '@volter/world-core';
import { gotoOf, signIn } from './shared.ts';

export async function login(ctx: HandlerContext): Promise<Response> {
  // source: spec:login "Log in, or create an account"
  return signIn(ctx, gotoOf(ctx.params.goto));
}
