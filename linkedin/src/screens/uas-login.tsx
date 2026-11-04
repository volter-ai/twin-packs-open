// LINKEDIN'S SIGN-IN at /uas/login, where linkedin.com sends a visitor from a member's page with the page's whole
// address as session_redirect (./shared.tsx toSignIn): the sign-in itself (./login.tsx).
import type { HandlerContext } from '@volter/world-core';
import { screen as signIn } from './login.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  return signIn(ctx);
}
