import type { HandlerContext } from '@volter/world-core';
import { dnsNumericBounds, ok, type Row } from './shared.ts';

// source: spec:dns-records-for-a-zone-create-dns-record "Create a new DNS record for a zone."
export async function dns_records_for_a_zone_create_dns_record(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row;
  const invalid = dnsNumericBounds(ctx, body);
  if (invalid) return invalid;
  // source: https://developers.cloudflare.com/dns/proxy-status/ "Other record types (such as MX or TXT) are always DNS-only."
  const proxiable = ['A', 'AAAA', 'CNAME'].includes(String(body.type));
  // source: spec:/components/schemas/dns-records_dns-record-response/allOf/1/properties/created_on "When the record was created."
  // source: spec:/components/schemas/dns-records_dns-record-response/allOf/1/properties/modified_on "When the record was last modified."
  // source: spec:/components/schemas/dns-records_dns-record-response/allOf/1/properties/meta "Extra Cloudflare-specific metadata about the record."
  const row = await ctx.create('dns-records_dns-record-response', {
    ...body, zone_id: ctx.call.params.zone_id, proxiable, created_on: ctx.occurredAt, modified_on: ctx.occurredAt, meta: {},
  }, 'dns-records-for-a-zone-create-dns-record');
  return ok(ctx.get('dns-records_dns-record-response', String(row.id)));
}
