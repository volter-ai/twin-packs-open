// OpenRouter's /auth page (docs/guides/overview/auth/oauth: "send your user to OpenRouter's `/auth` URL with a
// `callback_url` parameter"): a person signed in at openrouter.ai approves the application, and the page sends the
// browser back to the callback with a code (or shows it, with no callback). In a World the person is one of the World's
// people (the users door).
import type { HandlerContext } from '@volter/world-core';
import { CODE, PERSON, personByEmail, serial, sha256 } from '../semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (body: string, status = 200): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Authorize | OpenRouter</title></head><body>${body}</body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const q = request.method === 'POST' ? new URLSearchParams(ctx.text) : url.searchParams;
  const callback = q.get('callback_url');
  // source: https://openrouter.ai/docs/guides/overview/auth/oauth "pointing back to your site"
  // Where the documentation stops: malformed callback wording; reject before issuing any code.
  if (callback && !URL.canParse(callback)) return page('<p>Invalid callback_url.</p>', 400);
  const back = callback ? new URL(callback) : undefined;
  const challenge = q.get('code_challenge');
  const method = challenge ? (q.get('code_challenge_method') ?? 'plain') : null;
  const label = q.get('key_label');
  // source: https://openrouter.ai/docs/guides/overview/auth/oauth "is required in this mode"
  if (!callback && !challenge) return page('<p>A code_challenge is required when there is no callback_url.</p>', 400);
  if (method && method !== 'S256' && method !== 'plain') return page('<p>Invalid code_challenge_method.</p>', 400);
  if (request.method !== 'POST') {
    const people = ctx.rowsRaw(PERSON).filter((p) => p.deleted !== true);
    const hidden = [...url.searchParams].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
    return page(`<h1>Authorize ${esc(back ? back.host : label ?? 'this application')}</h1><p>It will get a key to use your OpenRouter credits.</p>${people.map((p) => `<form method="post" action="/auth">${hidden}<input type="hidden" name="email" value="${esc(p.email)}"><button type="submit">Authorize as ${esc(p.name ?? p.email)}</button></form>`).join('') || '<p>No one is signed in.</p>'}`);
  }
  const person = personByEmail(ctx, q.get('email') ?? '');
  if (!person) return page('<p>Sign in to OpenRouter first.</p>', 401);
  // a code is a credential until it is exchanged: drawn from the World's secret, kept by its SHA-256
  const code = (await ctx.secret(`openrouter-auth-code:${String(person.id)}:${ctx.occurredAt}:${await serial(ctx, 'auth-code')}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  await ctx.record(CODE, { user: person.id, challenge, method, key_label: label, callback, issued: ctx.occurredAt, status: 'active' }, sha256(ctx, code));
  if (!back) return page(`<h1>Your code</h1><p><code id="code">${esc(code)}</code></p><p>Paste it into your application. It expires in 10 minutes.</p>`);
  back.searchParams.set('code', code);
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}
