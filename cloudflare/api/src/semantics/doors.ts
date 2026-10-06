// The API lane's stand-ins: the World application's account and token (a sign-up, which no API makes), a DNS record
// published outside Cloudflare (a registrar's nameservers, a SaaS customer's own domain), and what the account's
// Notifications sent its webhook destinations, as their servers got it.
import type { HandlerContext } from '@volter/world-core';
import { accountRow, sameAccount, API_TOKEN, makeApiToken, apiTokenValue, tokenLive, groupRef, r2Policy, apiError, type Row } from '../../../src/semantics/shared.ts';

// source: https://developers.cloudflare.com/fundamentals/account/create-account/ "Create an account"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row; const name = typeof body.account === 'string' ? body.account : 'world';
  const owner = typeof body.owner === 'string' ? body.owner.toLowerCase() : 'owner@world.test'; const accountId = ctx.crypto.sha256(`world-account:${name}`).slice(0, 32);
  if (!accountRow(ctx, accountId)) {
    const existingUser = ctx.rowsRaw('cf_user').find(user => user.email === owner);
    const userId = existingUser ? String(existingUser.id) : ctx.mint('iam_single_user_response');
    if (!existingUser) await ctx.write('cf_user', userId, { id: userId, email: owner, first_name: null, last_name: null, username: userId,
      two_factor_authentication_enabled: false, created_on: ctx.occurredAt, modified_on: ctx.occurredAt, suspended: false }, 'world.signup');
    await ctx.write('account', accountId, { id: accountId, name, type: 'standard', settings: { enforce_twofactor: false }, created_on: ctx.occurredAt }, 'world.signup');
    const memberId = ctx.mint('iam_membership-with-policies');
    const refused = ctx.legal('iam_membership-with-policies', 'status', 'appCredentials', 'pending', 'accepted', memberId, 'external');
    if (refused) return ctx.refuse(refused);
    await ctx.write('account_member', memberId, { id: memberId, account_id: accountId, account: { id: accountId, name }, user_id: userId,
      email: owner, status: 'accepted', roles: ['Super Administrator - All Privileges'], permissions: {} }, 'world.signup');
  }
  const policies = [r2Policy(accountId, 'admin-rw', '*'), { effect: 'allow', resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
    permission_groups: ['Account Settings Read', 'Account Settings Write', 'Account API Tokens Read', 'Account API Tokens Write', 'Workers Scripts Read', 'Workers Scripts Write', 'Workers Tail Read', 'Turnstile Read', 'Turnstile Write', 'Zone Read', 'Zone Write'].map(groupRef) },
  // every zone of the account: its custom hostnames' certificates (Cloudflare for SaaS) and its DNS
  // source: https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/ "resources"
  { effect: 'allow', resources: { [`com.cloudflare.api.account.${accountId}`]: { 'com.cloudflare.api.account.zone.*': '*' } },
    permission_groups: ['SSL and Certificates Read', 'SSL and Certificates Write', 'DNS Read', 'DNS Write', 'Zone Read', 'Zone Write', 'Workers Routes Read', 'Workers Routes Write'].map(groupRef) }];
  const held = ctx.rowsRaw(API_TOKEN).find(token => token._kind === 'account' && sameAccount(ctx, token._account, accountId) && token.name === 'world' && tokenLive(token, ctx.occurredAt));
  const again = held ? await apiTokenValue(ctx, String(held.id)) : undefined;
  const made = held && again && held._sha256 === ctx.crypto.sha256(again) ? { token: held, value: again }
    : await makeApiToken(ctx, { name: 'world', kind: 'account', owner, account: accountId, policies });
  return Response.json({ api_token: made.value, account_id: accountId, r2_access_key_id: made.token.id,
    r2_secret_access_key: ctx.crypto.sha256(made.value), r2_endpoint: `https://${accountId}.r2.cloudflarestorage.com` }, { status: 201 });
}
// source: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/ "validate hostname ownership and affect the custom hostname"
export async function dns(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row;
  const name = String(body.name ?? '').toLowerCase(); const type = String(body.type ?? '').toUpperCase(); const value = String(body.value ?? '');
  if (!name || !['TXT', 'CNAME', 'A', 'AAAA', 'NS'].includes(type) || !value) return apiError(400, 10021, 'name, type and value are required.');
  await ctx.record('_external_dns', { name, type, value }, `${name}::${type}::${value}`);
  for (const zone of ctx.rowsRaw('zone')) {
    if (type !== 'NS' || name !== zone.name || !((zone.name_servers ?? []) as string[]).includes(value)) continue;
    const records = ctx.rowsRaw('_external_dns').filter(row => row.name === name && ctx.own(row).type === 'NS');
    if (!(zone.name_servers as string[]).every(server => records.some(row => row.value === server))) continue;
    if (zone.status === 'pending') {
      const refusal = ctx.legal('zones_zone', 'status', 'dns', zone.status, 'active', String(zone.id), 'vendor'); if (refusal) return ctx.refuse(refusal);
      await ctx.write('zone', String(zone.id), { status: 'active', activated_on: ctx.occurredAt }, 'zone.validate');
    }
  }
  for (const hostname of ctx.rowsRaw('custom_hostname')) {
    const ssl = (hostname.ssl ?? {}) as Row; const proof = (hostname.ownership_verification ?? {}) as Row;
    const records = (ssl.validation_records ?? []) as Row[];
    const changes: Row = {};
    const owned = type === 'TXT' && name === proof.name && value === proof.value;
    const zone = ctx.row('zone', String(hostname._zone));
    const cname = type === 'CNAME' && name === hostname.hostname && !!zone && (value === zone.name || value.endsWith(`.${zone.name}`));
    if ((owned || cname) && hostname.status === 'pending') {
      const refusal = ctx.legal('tls-certificates-and-hostnames_custom-hostname', 'status', 'dns', hostname.status, 'active', String(hostname.id), 'vendor'); if (refusal) return ctx.refuse(refusal);
      changes.status = 'active'; changes.verification_errors = [];
    }
    if ((records.some(record => type === 'TXT' && record.txt_name === name && record.txt_value === value) || cname && ssl.method === 'http') && ssl.status === 'pending_validation') {
      const refusal = ctx.legal('tls-certificates-and-hostnames_custom-hostname', 'ssl.status', 'dns', ssl.status, 'active', String(hostname.id), 'vendor'); if (refusal) return ctx.refuse(refusal);
      // the certificate's own write: validated, issued and deployed, which the account's Notifications report (events.ts)
      await ctx.write('custom_hostname', String(hostname.id), { ssl: { ...ssl, status: 'active', validation_records: [], issued_on: ctx.occurredAt } }, 'hostname.certificate');
    }
    if (Object.keys(changes).length) await ctx.write('custom_hostname', String(hostname.id), changes, 'hostname.validate');
  }
  return Response.json({ published: `${name} ${type}` }, { status: 201 });
}

/** GET /_twin/deliveries[?to=<url>][&type=<event>]: every notification Cloudflare sent a webhook destination (the
 *  kernel's record of each delivery, in the order sent), its headers and body as the receiving server got them. */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const rows = ctx.rowsRaw('_notification_delivery')
    .filter((d) => (q.get('to') === null || d.url === q.get('to')) && (q.get('type') === null || d.event_type === q.get('type')))
    .sort((a, b) => Number(a.sent_at) - Number(b.sent_at));
  return Response.json({ data: rows.map((d) => ({ url: d.url, type: d.event_type, sent_at: d.sent_at, headers: d.headers, body: JSON.parse(String(d.body)) })) });
}
