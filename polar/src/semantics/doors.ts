// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: the organization's access tokens, as its settings page makes them (the API makes none), and the webhooks
// the World sent the application's server, as that server received them.
import { sha256, type HandlerContext } from '@volter/world-core';
import { bodyOf, environment, secret } from './shared.ts';

/** An Organization Access Token as the settings page makes it (`polar_oat_…`, shown once): its name, scopes and
 *  expiration (none: it does not expire), kept by its SHA-256. */
// source: spec:/components/securitySchemes/oat "You can generate an **Organization Access Token** from your organization's settings."
async function makeToken(ctx: HandlerContext, comment: string, expiresInDays: number | null): Promise<{ token: string; id: string }> {
  const id = ctx.mint('_access_token');
  const token = await secret(ctx, 'polar_oat_', `access-token:${id}`);
  await ctx.record('_access_token', { comment, _environment: environment(ctx), _sha256: sha256(token), created_at: ctx.occurredAt, expires_at: expiresInDays === null ? null : new Date(Date.parse(ctx.occurredAt) + expiresInDays * 86_400_000).toISOString(), deleted: false }, id);
  return { token, id };
}

/** POST /_twin/access-tokens {comment, expires_in_days?}: an Organization Access Token made on the settings page. */
export async function accessTokens(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const days = typeof b.expires_in_days === 'number' ? b.expires_in_days : null;
  return Response.json(await makeToken(ctx, typeof b.comment === 'string' ? b.comment : 'token', days), { status: 201 });
}

/** DELETE /_twin/access-tokens/{n}: a token revoked on the settings page. */
export async function revokeToken(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.n);
  if (!ctx.rowsRaw('_access_token').some((t) => t.id === id && t.deleted !== true)) return Response.json({ error: 'no such token' }, { status: 404 });
  await ctx.record('_access_token', { deleted: true }, id);
  return new Response(null, { status: 204 });
}

/** POST /_twin/app-credentials: the access token an application holds, as the runtime issues it (the descriptor's
 *  credentialDoor). */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  // the application's one token, made the first time the runtime asks and the same at every boot after
  const token = await secret(ctx, 'polar_oat_', `access-token:app:${environment(ctx)}`);
  if (!ctx.rowsRaw('_access_token', { withDeleted: true }).some((t) => t.id === `oat_app_${environment(ctx)}` && t._sha256 === sha256(token))) {
    await ctx.record('_access_token', { comment: 'world', _environment: environment(ctx), _sha256: sha256(token), created_at: ctx.occurredAt, expires_at: null, deleted: false }, `oat_app_${environment(ctx)}`);
  }
  return Response.json({ access_token: token }, { status: 201 });
}

/** GET /_twin/deliveries[?to=<url>][&type=<event>]: every webhook Polar sent (the kernel's record of each delivery, in
 *  the order sent): what the application's server was told, and when. */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const rows = ctx.rowsRaw('_webhook_delivery')
    .filter((d) => (q.get('to') === null || d.url === q.get('to')) && (q.get('type') === null || d.event_type === q.get('type')))
    .sort((a, b) => Number(a.sent_at) - Number(b.sent_at));
  return Response.json({ data: rows.map((d) => ({ url: d.url, type: d.event_type, sent_at: d.sent_at, headers: d.headers, body: JSON.parse(String(d.body)) })) });
}
