// What the console's pages share: its skin, its session cookie, and the page that sends a visitor to sign in.
import { toSignIn } from '@volter/world-ui';

export type Row = Record<string, unknown>;

export const COOKIE = 'upstash_twin_session';

export const SKIN = `
body { background: #fafafa; color: #18181b; }
.sign-in-mark { background: #00e9a3; border-radius: 8px; }
.sign-in-box { background: #ffffff; border-color: #e4e4e7; }
.sign-in-submit { background: #10b981; border-color: #10b981; color: #ffffff; }
.portal-side { background: #f4f4f5; border-right: 1px solid #e4e4e7; }
.portal-notice { background: #ecfdf5; border: 1px solid #10b981; font-family: ui-monospace, monospace; word-break: break-all; }
.portal-primary { background: #10b981; border-color: #10b981; color: #ffffff; }
`;

export const toLogin = (path: string): Response => toSignIn('/login', path);

/** A page is opened with GET, and its forms post to it. The twin's own answer for any other method: 405. */
export const notAllowed = (): Response => new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET, POST' } });
