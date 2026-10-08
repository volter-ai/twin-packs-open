// What Slack's pages share (docs/contributing/architecture.md, "Pack layout": screens/shared.tsx): who is on the page,
// Slack's look, and a page's form. Authored from plain markup under Slack's type; nothing of Slack's pages is copied.
//
// WHO IS ON A PAGE. A client bearer token names its user; an ordinary browser uses the opaque session
// established after email confirmation in signin.tsx. Both identify an existing, active workspace member.
import type { HandlerContext } from '@volter/world-core';
import { flowPage, signedIn } from '@volter/world-ui';
import { personOfToken } from '../engine/wire.ts';

type Row = Record<string, unknown>;

// The browser's opaque vendor session is the kernel's session kit. The API still uses client tokens.
export const CLIENT_COOKIE = 'slack_client_session';

export const SLACK_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #f8f8f8; color: #1d1c1d; font-family: Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; font-size: 15px; }
.sk { max-width: 720px; margin: 48px auto; padding: 0 16px; }
.sk h1 { font-size: 28px; margin: 0 0 8px; }
.sk-lead { color: #616061; margin: 0 0 24px; }
.sk-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
.sk-card label { display: block; font-weight: 700; margin: 12px 0 6px; }
.sk-card input, .sk-card select, .sk-card textarea { width: 100%; padding: 9px 12px; border: 1px solid #bbb; border-radius: 4px; font: inherit; }
.sk-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #eee; }
.sk-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.sk button { background: #007a5a; color: #fff; border: 0; border-radius: 4px; padding: 9px 16px; font: inherit; font-weight: 700; cursor: pointer; }
.sk button.sk-quiet { background: #fff; color: #1d1c1d; border: 1px solid #bbb; }
.sk-notice { background: #e8f5fa; border-radius: 4px; padding: 10px 12px; margin-bottom: 16px; }
.sk code { font: 14px Monaco, Menlo, monospace; background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
`;

type Body = Parameters<typeof flowPage>[0]['body'];

/** A Slack page. */
export const page = (title: string, body: Body, status = 200, css: string[] = []): Response => flowPage({ title: `${title} | Slack`, css: [SLACK_CSS, ...css], body: <main className="sk">{body}</main>, status });

/** A page's answer for a person who may not use it, or for nobody signed in. */
export const refused = (status: number, text: string): Response => page('Slack', <><h1>{text}</h1></>, status);

/** The person on the page: the id their client token names, and their row when they are a member. */
export function visitor(ctx: HandlerContext): { id: string; row?: Row } | undefined {
  const token = /^bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const person = token ? undefined : signedIn(ctx, CLIENT_COOKIE);
  const member = person ? ctx.rowsRaw('user').find(u => u.deleted !== true && String((u.profile as Row | undefined)?.email ?? '').toLowerCase() === person.email.toLowerCase()) : undefined;
  const id = token ? personOfToken(token) : member ? String(member.id) : undefined;
  if (!id) return undefined;
  const row = ctx.row('user', id);
  return { id, ...(row && row.deleted !== true ? { row } : {}) };
}

/** A posted field. */
export const field = (ctx: HandlerContext, name: string): string => { const v = ctx.params[name]; return v === undefined || v === null ? '' : String(v); };

/** Whether a member administers their workspace. */
export const administers = (u: Row | undefined): boolean => u?.is_admin === true || u?.is_owner === true || u?.is_primary_owner === true;

/** A 302 to a location. */
export const seeOther = (location: string): Response => new Response(null, { status: 302, headers: { location } });
