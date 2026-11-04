// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: the organization's access tokens, as its settings page makes them (the API makes none), and the webhooks
// the World sent the application's server, as that server received them.
import { sha256, type HandlerContext } from '@volter/world-core';
import { bodyOf, environment, fail, nativeOrganization, secret, settingsOrganization, type Row } from './shared.ts';

/** An Organization Access Token as the settings page makes it (`polar_oat_…`, shown once): its name, scopes and
 *  expiration (none: it does not expire), kept by its SHA-256. */
// source: spec:/components/securitySchemes/oat "You can generate an **Organization Access Token** from your organization's settings."
async function makeToken(ctx: HandlerContext, organization: Row, comment: string, expiresInDays: number | null): Promise<{ token: string; id: string }> {
  const id = await ctx.issue('_access_token');
  const token = await secret(ctx, 'polar_oat_', `access-token:${id}`);
  await ctx.record('_access_token', { comment, _organization_id: organization.id, _environment: environment(ctx), _sha256: sha256(token), created_at: ctx.occurredAt, expires_at: expiresInDays === null ? null : new Date(Date.parse(ctx.occurredAt) + expiresInDays * 86_400_000).toISOString(), deleted: false }, id);
  return { token, id };
}

/** POST /_twin/access-tokens {comment, expires_in_days?}: an Organization Access Token made on the settings page. */
export async function accessTokens(ctx: HandlerContext): Promise<Response> {
  const organization = await settingsOrganization(ctx);
  if (!organization) return fail(401, 'Unauthorized', 'Unauthorized');
  const b = bodyOf(ctx);
  const days = typeof b.expires_in_days === 'number' ? b.expires_in_days : null;
  return Response.json(await makeToken(ctx, organization, typeof b.comment === 'string' ? b.comment : 'token', days), { status: 201 });
}

/** DELETE /_twin/access-tokens/{n}: a token revoked on the settings page. */
export async function revokeToken(ctx: HandlerContext): Promise<Response> {
  const organization = await settingsOrganization(ctx);
  if (!organization) return fail(401, 'Unauthorized', 'Unauthorized');
  const id = String(ctx.call.params.n);
  if (!ctx.rowsRaw('_access_token').some((t) => t.id === id && t.deleted !== true && t._organization_id === organization.id && t._environment === environment(ctx))) return Response.json({ error: 'no such token' }, { status: 404 });
  await ctx.record('_access_token', { deleted: true }, id);
  return new Response(null, { status: 204 });
}

/** POST /_twin/app-credentials: the access token an application holds, as the runtime issues it (the descriptor's
 *  credentialDoor). */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const organization = await nativeOrganization(ctx);
  const read = async (row: Row): Promise<string | undefined> => {
    if (row._organization_id !== organization.id || row._environment !== environment(ctx) || row.deleted === true
      || (row.expires_at !== null && Date.parse(String(row.expires_at)) <= Date.parse(ctx.occurredAt))) return undefined;
    const seed = organization._world_organization === 'default' && row.id === `oat_app_${environment(ctx)}`
      ? `access-token:app:${environment(ctx)}` : `access-token:${row.id}`;
    const value = await secret(ctx, 'polar_oat_', seed);
    return row._sha256 === sha256(value) ? value : undefined;
  };
  const key = await ctx.accountKey(`organization-token:${organization.id}`, '_access_token', {
    make: async () => {
      if (organization._world_organization === 'default' && ctx.deployment() === '') {
        const held = ctx.row('_access_token', `oat_app_${environment(ctx)}`);
        if (held && await read(held) !== undefined) return String(held.id);
      }
      return (await makeToken(ctx, organization, ctx.deployment() || 'world', null)).id;
    },
    read,
  });
  return Response.json({ access_token: key.secret }, { status: 201 });
}

/** GET /_twin/deliveries[?to=<url>][&type=<event>]: webhooks accepted by the application's server, in send order,
 *  with their headers, body and send time. */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  if (!await settingsOrganization(ctx)) return fail(401, 'Unauthorized', 'Unauthorized');
  const q = new URL(ctx.call.request.url).searchParams;
  const rows = ctx.rowsRaw('_webhook_delivery')
    .filter((d) => typeof d.accepted_at === 'number' && (q.get('to') === null || d.url === q.get('to')) && (q.get('type') === null || d.event_type === q.get('type')))
    .sort((a, b) => Number(a.sent_at) - Number(b.sent_at));
  return Response.json({ data: rows.map((d) => ({ url: d.url, type: d.event_type, sent_at: d.sent_at, headers: d.headers, body: JSON.parse(String(d.body)) })) });
}
