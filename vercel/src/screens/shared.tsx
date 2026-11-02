// What the dashboard's pages share: its skin, its session cookie, the team the signed-in person owns.
import type { HandlerContext } from '@volter/world-core';
import { toSignIn } from '@volter/world-ui';
import { TEAM } from '../semantics/shared.ts';

export type Row = Record<string, unknown>;

export const COOKIE = 'vercel_twin_session';

export const SKIN = `
body { background: #ffffff; color: #000000; }
.sign-in-mark { background: #000000; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.sign-in-box { background: #ffffff; border-color: #eaeaea; }
.sign-in-submit { background: #000000; border-color: #000000; color: #ffffff; }
.portal-side { background: #fafafa; border-right: 1px solid #eaeaea; }
.portal-notice { background: #fafafa; border: 1px solid #000000; font-family: ui-monospace, monospace; word-break: break-all; }
.portal-primary { background: #000000; border-color: #000000; color: #ffffff; }
`;

export const toLogin = (path: string): Response => toSignIn('/login', path);
export const teamsOf = (ctx: HandlerContext, person: Row): Row[] => ctx.rowsRaw(TEAM).filter((t) => t._owner === person.email && t.deleted !== true);
export const notAllowed = (): Response => new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET, POST' } });
