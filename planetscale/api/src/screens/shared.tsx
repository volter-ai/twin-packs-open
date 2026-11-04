// What the dashboard's pages share: its skin, its session cookie, the organization the signed-in person administers.
import type { HandlerContext } from '@volter/world-core';
import { toSignIn } from '@volter/world-ui';
import { organizationOf } from '../semantics/shared.ts';

export type Row = Record<string, unknown>;

export const COOKIE = 'pscale_twin_session';

export const SKIN = `
body { background: #ffffff; color: #111827; }
.sign-in-mark { background: #111827; border-radius: 6px; }
.sign-in-box { background: #ffffff; border-color: #e5e7eb; }
.sign-in-submit { background: #111827; border-color: #111827; color: #ffffff; }
.portal-side { background: #f9fafb; border-right: 1px solid #e5e7eb; }
.portal-notice { background: #f0fdf4; border: 1px solid #16a34a; font-family: ui-monospace, monospace; word-break: break-all; }
.portal-primary { background: #111827; border-color: #111827; color: #ffffff; }
`;

export const toLogin = (path: string): Response => toSignIn('/sign-in', path);

/** The organization a page names, when the signed-in person administers it (its sign-up made them so). */
export function adminOf(ctx: HandlerContext, person: Row, name: string): Row | undefined {
  const org = organizationOf(ctx, name);
  return org && org._admin === person.email ? org : undefined;
}

export const notFound = (): Response => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
export const notAllowed = (): Response => new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET, POST' } });
