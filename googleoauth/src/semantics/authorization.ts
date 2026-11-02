// Google's authorization endpoint: a registered client's request, answered with the account chooser (the World's Google
// accounts); choosing one returns the browser to the client's redirect with a code (the server's `/o/oauth2/v2/auth/choose`).
import type { HandlerContext } from '@volter/world-core';
import { clientById, type Row } from './shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The chooser: each of the World's Google accounts, a button that consents for it. */
function chooser(ctx: HandlerContext): Response {
  const q = ctx.params as Row;
  const client = clientById(ctx, String(q.client_id ?? ''));
  // an unknown client or redirect is Google's "Error 400: redirect_uri_mismatch" / "invalid_client" page
  if (!client) return new Response('Error 401: invalid_client — The OAuth client was not found.', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (!((client.redirect_uris as string[] | undefined) ?? []).includes(String(q.redirect_uri ?? ''))) return new Response('Error 400: redirect_uri_mismatch', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const query = new URL(ctx.call.request.url).searchParams.toString();
  const accounts = ctx.rowsRaw('account').filter((a) => a.deleted !== true).sort((a, b) => String(a.email).localeCompare(String(b.email)));
  const list = accounts.map((a) => `<form method="post" action="/o/oauth2/v2/auth/choose"><input type="hidden" name="request" value="${esc(query)}"><input type="hidden" name="sub" value="${esc(a.id)}"><button type="submit"><strong>${esc(a.name ?? a.email)}</strong><br><small>${esc(a.email)}</small></button></form>`).join('');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in - Google Accounts</title><style>body{font:15px/1.5 Roboto,system-ui,sans-serif;margin:0;background:#fff}main{max-width:440px;margin:48px auto;border:1px solid #dadce0;border-radius:8px;padding:36px 40px}h1{font-size:24px;font-weight:400;margin:0 0 4px}button{display:block;width:100%;text-align:left;background:#fff;border:0;border-bottom:1px solid #dadce0;padding:12px 4px;font:inherit;cursor:pointer}small{color:#5f6368}</style></head><body><main><h1>Choose an account</h1><p>to continue to <strong>${esc(client.name ?? client.client_id)}</strong></p>${list || '<p>No Google account is in this World.</p>'}<p><small>Google Accounts, the World's twin of accounts.google.com</small></p></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// source: https://developers.google.com/identity/openid-connect/openid-connect "select_account The authorization server prompts the user to select a user account."
export async function authorize(ctx: HandlerContext): Promise<Response> { return chooser(ctx); }
