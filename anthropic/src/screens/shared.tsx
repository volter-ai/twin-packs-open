// What the Console's pages share: its skin, its session cookie, and the page a signed-out person is sent from.
import { toSignIn } from '@volter/world-ui';
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;

export const COOKIE = 'anthropic_twin_session';

export const SKIN = `
body { background: #faf9f5; color: #141413; }
.sign-in-mark { background: #d97757; border-radius: 50%; }
.sign-in-box { background: #ffffff; border-color: #e8e6dc; }
.sign-in-submit { background: #141413; border-color: #141413; color: #faf9f5; }
.portal-side { background: #f0eee6; border-right: 1px solid #e8e6dc; }
.portal-notice { background: #ffffff; border: 1px solid #d97757; font-family: ui-monospace, monospace; word-break: break-all; }
.portal-primary { background: #141413; border-color: #141413; color: #faf9f5; }
`;

export function consolePath(ctx: HandlerContext, path: string): string {
  const base = new URL(ctx.publicBase).pathname.replace(/\/+$/, '');
  return base && (path === base || path.startsWith(`${base}/`)) ? path : `${base}${path}`;
}
export const toLogin = (ctx: HandlerContext, path: string): Response => toSignIn(consolePath(ctx, '/login'), consolePath(ctx, path));
export const notAllowed = (): Response => new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET, POST' } });
