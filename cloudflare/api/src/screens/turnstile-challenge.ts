// Turnstile's challenge, the frame the widget (api.js, the `turnstile-api` screen) puts on a site's page: the visitor
// passes it with a click, and the frame hands the page a token (one use, 300 seconds) that the site's server checks at
// siteverify. The frame refuses a sitekey the World holds no widget for, and a page on a domain its widget does not
// list, with Turnstile's client error codes.
import type { HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A page of the frame: what the visitor sees, and the message it posts to the widget on the site's page. */
const page = (title: string, body: string, message?: Row): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui,sans-serif;margin:0;padding:12px;border:1px solid #e0e0e0;border-radius:4px;display:flex;align-items:center;gap:12px}button{font:inherit;padding:6px 12px}</style></head>
<body>${body}${message ? `<script>parent.postMessage(${JSON.stringify({ source: 'cloudflare-challenge', ...message }).replace(/</g, '\\u003c')}, '*')</script>` : ''}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

/** Whether a page's hostname is one of the widget's domains or under one. */
// source: spec:/components/schemas/turnstile_domains "The widget will only work on these domains, and their subdomains."
const allowed = (widget: Row, hostname: string): boolean => ((widget.domains ?? []) as string[]).some((d) => hostname === d || hostname.endsWith(`.${d}`));

// source: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/ "Domain not authorized"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const form = ctx.call.request.method === 'POST' ? Object.fromEntries(new URLSearchParams(ctx.text)) : Object.fromEntries(url.searchParams);
  const sitekey = String(form.sitekey ?? ''); const hostname = String(form.hostname ?? '').toLowerCase(); const id = String(form.id ?? '');
  const action = String(form.action ?? ''); const cdata = String(form.cdata ?? '');
  const widget = ctx.rowsRaw('turnstile_widget').find((w) => w.id === sitekey && w.deleted !== true);
  // source: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/ "Sitekey not found"
  if (!widget) return page('Error', '<p>Error 110110: the sitekey is not a widget\'s.</p>', { event: 'error', id, code: '110110' });
  if (!allowed(widget, hostname)) return page('Error', `<p>Error 110200: ${esc(hostname)} is not one of the widget's domains.</p>`, { event: 'error', id, code: '110200' });
  if (ctx.call.request.method !== 'POST') {
    return page('Verify you are human', `<form method="post"><input type="hidden" name="sitekey" value="${esc(sitekey)}"><input type="hidden" name="hostname" value="${esc(hostname)}">
<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="action" value="${esc(action)}"><input type="hidden" name="cdata" value="${esc(cdata)}">
<label><input type="checkbox" required> Verify you are human</label><button type="submit">Verify</button></form>`);
  }
  // the visitor passed: a token for the site's server, valid for 300 seconds, once
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Each token is valid for 300 seconds (5 minutes) after generation."
  const serial = ctx.mint('_turnstile_token');
  const token = `0.${await ctx.secret(`turnstile-token:${serial}`)}`;
  await ctx.record('_turnstile_token', { sitekey, hostname, action, cdata, challenge_ts: ctx.occurredAt, token_sha256: ctx.crypto.sha256(token) }, serial);
  return page('Success!', `<p>Success!</p><p>Token: ${esc(token)}</p>`, { event: 'complete', id, token });
}
