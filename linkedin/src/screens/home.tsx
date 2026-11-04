// LINKEDIN'S ROOT — www.linkedin.com/ (a workspace, docs/contributing/architecture.md, "Screens"): a member's feed, and
// for a visitor linkedin.com's guest page, "LinkedIn: Log In or Sign Up", whose sign-in is its link "Sign in with email"
// to the sign-in page (read with GET on 2026-10-03: 200, no redirect, no password form of its own; its other sign-ins,
// Google's and Microsoft's, are not this World's). Under it, a path of linkedin.com the pack does not draw (a profile,
// jobs, messaging) is LinkedIn's page-not-found, never an API's answer.
import type { HandlerContext } from '@volter/world-core';
import { cannotDisplay, GlobalNav, memberOf, page, seeOther } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const member = memberOf(ctx);
  if (new URL(ctx.call.request.url).pathname !== '/') return cannotDisplay(ctx, member, 'Page not found', 'This page doesn’t exist');
  if (member) return seeOther(ctx, '/feed/');
  return page(ctx, 'LinkedIn: Log In or Sign Up', (
    <>
      <GlobalNav member={undefined} />
      <main className="sign-in">
        <h1 className="sign-in-heading">Discover new opportunities</h1>
        <a className="btn btn-primary" href="/login">Sign in with email</a>
      </main>
    </>
  ));
}
