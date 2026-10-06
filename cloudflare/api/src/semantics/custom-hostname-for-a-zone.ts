// Cloudflare for SaaS custom hostnames: a customer's own domain served by the zone. Create and edit answer what was not
// sent: the ownership verification and the certificate's validation records, for the method chosen. Its list, read and
// delete are the core's. It turns active when its customer publishes the records at their DNS host (the `dns` door).
import type { HandlerContext } from '@volter/world-core';
import { fail, ok, type Row } from './shared.ts';

const HOSTNAME = 'custom_hostname';
const RESOURCE = 'tls-certificates-and-hostnames_custom-hostname';
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const uuidOf = (ctx: HandlerContext, seed: string): string => {
  const h = ctx.crypto.digest('sha256', seed, 'hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** The certificate's validation records for its method: a TXT at `_acme-challenge.<hostname>`, or a token served at the
 *  hostname's `/.well-known/acme-challenge/` ("Validation records", https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/). */
function validationRecords(ctx: HandlerContext, id: string, hostname: string, method: string): Row[] {
  // p3: a validation token the customer publishes (a TXT record or a well-known file), not a credential
  const token = ctx.crypto.digest('sha256', `acme:${id}:${method}`, 'base64url').slice(0, 43);
  if (method === 'http') return [{ http_url: `http://${hostname}/.well-known/acme-challenge/${token.slice(0, 22)}`, http_body: token, status: 'pending' }];
  return [{ txt_name: `_acme-challenge.${hostname}`, txt_value: token, status: 'pending' }];
}

/** `POST /zones/{zone}/custom_hostnames` `{ hostname, ssl: { method, type, settings } }`: pending, with the TXT (or HTTP)
 *  ownership check and the certificate's validation records its customer must publish. */
// source: spec:custom-hostname-for-a-zone-create-custom-hostname "Add a new custom hostname and request that an SSL certificate be issued for it."
export async function custom_hostname_for_a_zone_create_custom_hostname(ctx: HandlerContext): Promise<Response> {
  const zone = String(ctx.call.params.zone_id);
  if (!ctx.row('zone', zone)) return fail(404, 1001, 'Invalid zone identifier');
  const b = bodyOf(ctx);
  const hostname = typeof b.hostname === 'string' ? b.hostname.toLowerCase() : '';
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) return fail(400, 1411, 'Invalid custom hostname');
  // Where the documentation stops: the refusal of a hostname the World already serves (its code and words) is the twin's
  if (ctx.rowsRaw(HOSTNAME).some((h) => h.hostname === hostname && h.deleted !== true)) return fail(409, 1406, 'Duplicate custom hostname found.');
  const ssl = (b.ssl as Row | undefined) ?? {};
  const method = String(ssl.method ?? 'http');
  if (!['http', 'txt', 'email'].includes(method)) return fail(400, 1413, 'Invalid SSL validation method');
  const id = ctx.mint('tls-certificates-and-hostnames_custom-hostname');
  const secret = uuidOf(ctx, `ownership:${id}`);
  await ctx.write(HOSTNAME, id, {
    id, hostname, _zone: zone, status: 'pending', created_at: ctx.occurredAt, custom_metadata: b.custom_metadata ?? undefined,
    ssl: {
      id: uuidOf(ctx, `ssl:${id}`), type: ssl.type ?? 'dv', method, status: 'pending_validation', bundle_method: ssl.bundle_method ?? 'ubiquitous', wildcard: ssl.wildcard === true,
      certificate_authority: ssl.certificate_authority ?? 'google', settings: (ssl.settings as Row | undefined) ?? { min_tls_version: '1.0' }, validation_records: validationRecords(ctx, id, hostname, method),
    },
    ownership_verification: { type: 'txt', name: `_cf-custom-hostname.${hostname}`, value: secret },
    ownership_verification_http: { http_url: `http://${hostname}/.well-known/cf-custom-hostname-challenge/${id}`, http_body: secret },
    verification_errors: ['custom hostname does not CNAME to this zone.'],
  }, 'custom_hostname.create');
  return ok(ctx.get(RESOURCE, id));
}

/** `PATCH /zones/{zone}/custom_hostnames/{id}` `{ ssl: { method } , custom_metadata, custom_origin_server }`: a new
 *  validation method issues new validation records, pending again. */
// source: spec:custom-hostname-for-a-zone-edit-custom-hostname "Modify SSL configuration for a custom hostname. When sent with SSL config that matches existing config, used to indicate that hostname should pass domain control validation (DCV)."
export async function custom_hostname_for_a_zone_edit_custom_hostname(ctx: HandlerContext): Promise<Response> {
  const h = ctx.row(HOSTNAME, String(ctx.call.params.custom_hostname_id));
  if (!h || h._zone !== ctx.call.params.zone_id || h.deleted === true) return fail(404, 1436, 'The custom hostname was not found.');
  const b = bodyOf(ctx);
  const changes: Row = {};
  for (const k of ['custom_metadata', 'custom_origin_server', 'custom_origin_sni']) if (k in b) changes[k] = b[k];
  const now = (h.ssl as Row | undefined) ?? {};
  const asked = (b.ssl as Row | undefined) ?? undefined;
  if (asked) {
    const method = String(asked.method ?? now.method);
    if (!['http', 'txt', 'email'].includes(method)) return fail(400, 1413, 'Invalid SSL validation method');
    const same = method === now.method;
    const moves = !(same && now.status === 'active');
    if (moves && ctx.legal('tls-certificates-and-hostnames_custom-hostname', 'ssl.status', 'custom-hostname-for-a-zone-edit-custom-hostname', String(now.status), 'pending_validation', String(h.id))) return fail(400, 1413, 'Invalid SSL validation method');
    changes.ssl = { ...now, ...asked, method, ...(!moves ? {} : { status: 'pending_validation', validation_records: validationRecords(ctx, String(h.id), String(h.hostname), method) }) };
  }
  await ctx.write(HOSTNAME, String(h.id), changes, 'custom_hostname.update');
  return ok(ctx.get(RESOURCE, String(h.id)));
}
