// What the account's Notifications send its webhook destinations about a custom hostname's certificate (the manifest's
// `events`): the generic webhook's envelope around the SSL for SaaS event, whose `data` names the hostname and whose
// `metadata` its zone and account.
import type { EventWrite, WriteHookContext } from '@volter/world-core';
import { zoneAccount } from './shared.ts';

type Row = Record<string, unknown>;

/** The certificate's status each event reports it in. */
// source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/webhook-definitions/ "Cloudflare sends this alert when certificates move from a status of"
const STATUS: Record<string, string> = {
  'ssl.custom_hostname_certificate.validation.succeeded': 'pending_issuance',
  'ssl.custom_hostname_certificate.issuance.succeeded': 'pending_deployment',
  'ssl.custom_hostname_certificate.deployment.succeeded': 'active',
  'ssl.custom_hostname_certificate.deletion.succeeded': 'deleted',
};

/** An event's `data`: the SSL for SaaS event, its id, type and time, the account and zone, and the hostname with its
 *  certificate in the status the event reports. Where the documentation stops: the event's id is the twin's, a UUID of
 *  the hostname, the type and the instant. */
// source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/webhook-definitions/ "The following section details the data Cloudflare sends to a webhook destination."
export function data(ctx: WriteHookContext, write: EventWrite, type: string): Row {
  const h = write.body;
  const zone = ctx.row('zone', String(ctx.row('custom_hostname', String(h.id), { withDeleted: true })?._zone));
  const ssl = (h.ssl ?? {}) as Row;
  return {
    metadata: {
      event: { id: ctx.crypto.uuidFrom(`cloudflare-notification:${String(h.id)}:${type}:${write.occurredAt}`), type, created_at: write.occurredAt },
      account: { id: zoneAccount(zone) || null }, zone: { id: zone?.id },
    },
    data: {
      id: h.id, hostname: h.hostname,
      ssl: { id: ssl.id, type: ssl.type ?? 'dv', method: ssl.method, status: STATUS[type] ?? ssl.status, ...(type.includes('.deletion.') ? {} : { settings: ssl.settings ?? {} }) },
      custom_metadata: h.custom_metadata ?? {}, ...(h.custom_origin_server ? { custom_origin_server: h.custom_origin_server } : {}),
    },
  };
}

/** The envelope's values beside the event: the account it is about (only that account's policies take it) and the
 *  notification's words. Where the documentation stops: the words are the twin's, naming the hostname and the event. */
// source: https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/ "A human-readable description of the notification with interpolated values."
export function values(ctx: WriteHookContext, write: EventWrite, type: string): Row {
  const zone = ctx.row('zone', String(ctx.row('custom_hostname', String(write.body.id), { withDeleted: true })?._zone));
  const stage = type.split('.').slice(-2).join(' ');
  return { $account: zoneAccount(zone), $text: `Custom hostname ${String(write.body.hostname)}: certificate ${stage}` };
}
