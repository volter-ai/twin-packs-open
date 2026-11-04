// news.ycombinator.com/login: a bare page of the login form and the create-account form (acct, pw; creating=t), both
// posting to the page's own address, the page to return to in its query (POST /login, ../semantics/login.ts).
import type { HandlerContext } from '@volter/world-core';
import { loginForms } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  return loginForms(ctx, 'Login');
}
