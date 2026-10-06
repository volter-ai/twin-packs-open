// Turnstile's siteverify, challenges.cloudflare.com/turnstile/v0/siteverify: a site's server checks the token its
// visitor's browser earned from the widget (the `turnstile-challenge` screen) with the widget's secret, as a form or
// as JSON. A token is valid for 300 seconds and only once; a second check, or a late one, is timeout-or-duplicate.
import type { HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;

const answer = (body: Row, status = 200): Response => Response.json(body, { status });
const failed = (...codes: string[]): Response => answer({ success: false, 'error-codes': codes });

function fieldsOf(ctx: HandlerContext): Row {
  if (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)) return ctx.body as Row;
  return Object.fromEntries(new URLSearchParams(ctx.text));
}

// source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Each token can only be validated once."
export async function screen(ctx: HandlerContext): Promise<Response> {
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Request is malformed"
  if (ctx.call.request.method !== 'POST') return failed('bad-request');
  const f = fieldsOf(ctx);
  const secret = typeof f.secret === 'string' ? f.secret : '';
  const response = typeof f.response === 'string' ? f.response : '';
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Secret parameter not provided"
  if (!secret) return failed('missing-input-secret');
  const widget = ctx.rowsRaw('turnstile_widget').find((w) => w.secret === secret && w.deleted !== true);
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Secret key is invalid or expired"
  if (!widget) return failed('invalid-input-secret');
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Response parameter was not provided"
  if (!response) return failed('missing-input-response');
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Maximum length: 2048 characters"
  if (response.length > 2048) return failed('invalid-input-response');
  // p3: the token is found by the hash of what the visitor sent, as a credential is held; no secret is computed
  const token = ctx.rowsRaw('_turnstile_token').find((t) => t.token_sha256 === ctx.crypto.sha256(response));
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Token is invalid, malformed, or expired"
  if (!token || token.sitekey !== widget.id) return failed('invalid-input-response');
  // its checks are its history's writes after the one that issued it
  const checked = ctx.history('_turnstile_token', String(token.id)).length > 1;
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Each token is valid for 300 seconds (5 minutes) after generation."
  if (checked || Date.parse(ctx.occurredAt) - Date.parse(String(token.challenge_ts)) > 300_000) return failed('timeout-or-duplicate');
  await ctx.record('_turnstile_token', { checked_at: ctx.occurredAt }, String(token.id));
  // source: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ "Hostname where the challenge was served"
  return answer({ success: true, challenge_ts: token.challenge_ts, hostname: token.hostname, 'error-codes': [], action: token.action ?? '', cdata: token.cdata ?? '', metadata: {} });
}
