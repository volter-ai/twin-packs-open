// R2 control-plane operations share the vendor's bucket/credential/domain subjects with its S3 lane.
import type { HandlerContext } from '@volter/world-core';
import { ofBucket, bucketNamed, accountRow, sameAccount, zoneAccount, BUCKET, DOMAIN, TEMPORARY, API_TOKEN, bucketKey, bucketNameValid, putBucket, bearerToken, tokenLive,
  personInAccount, r2Grant, apiOk, apiError, publicBucket, publicDomain, apiBucket, domainInput, type Row } from './shared.ts';

// source: spec:r2-create-bucket "Create Bucket"
export async function r2_create_bucket(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row; const account = String(ctx.call.params.account_id);
  const jurisdiction = ctx.call.request.headers.get('cf-r2-jurisdiction') ?? 'default';
  if (typeof body.name !== 'string' || !bucketNameValid(body.name)) return apiError(400, 10021, 'Invalid bucket name.');
  if (!['default', 'eu', 'us', 'fedramp', 'fedramp-high'].includes(jurisdiction)
    || body.locationHint !== undefined && !['apac', 'eeur', 'enam', 'weur', 'wnam', 'oc'].includes(String(body.locationHint))
    || body.storageClass !== undefined && !['Standard', 'InfrequentAccess'].includes(String(body.storageClass))) return apiError(400, 10021, 'Invalid bucket configuration.');
  if (!accountRow(ctx, account)) return apiError(404, 7003, 'Account not found.');
  if (bucketNamed(ctx, account, body.name)) return apiError(409, 10021, 'Bucket already exists.');
  await putBucket(ctx, account, body.name, jurisdiction, typeof body.locationHint === 'string' ? body.locationHint : null, String(body.storageClass ?? 'Standard'));
  return apiOk(publicBucket(bucketNamed(ctx, account, body.name)!));
}
// source: spec:r2-get-bucket "Gets properties of an existing R2 bucket."
export async function r2_get_bucket(ctx: HandlerContext): Promise<Response> {
  const bucket = apiBucket(ctx); if (!bucket) return apiError(404, 10006, 'The specified bucket does not exist.');
  return apiOk(publicBucket(bucket));
}
// source: spec:r2-list-buckets "Lists a page of R2 buckets in the account and selected jurisdiction."
// source: spec:r2-list-buckets "Buckets are ordered lexicographically."
// Where the documentation stops: the cursor's form is R2's own; the twin's is the last bucket name of the page
export async function r2_list_buckets(ctx: HandlerContext): Promise<Response> {
  const account = String(ctx.call.params.account_id);
  if (!accountRow(ctx, account)) return apiError(404, 7003, 'Account not found.');
  const jurisdiction = ctx.call.request.headers.get('cf-r2-jurisdiction') ?? 'default';
  const q = new URL(ctx.call.request.url).searchParams;
  const contains = q.get('name_contains') ?? '';
  const after = q.get('cursor') ?? q.get('start_after') ?? '';
  const per = Math.min(Math.max(Number(q.get('per_page') ?? 20) || 20, 1), 1000);
  const all = ctx.rowsRaw(BUCKET).filter((b) => sameAccount(ctx, b.account_id, account) && b.jurisdiction === jurisdiction && b.deleted !== true && String(b.name).includes(contains))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const ordered = q.get('direction') === 'desc' ? all.reverse() : all;
  const from = after ? ordered.findIndex((b) => b.name === after) + 1 : 0;
  const page = ordered.slice(from, from + per);
  const more = from + per < ordered.length;
  return apiOk({ buckets: page.map((b) => publicBucket(b)) }, 200, { result_info: { per_page: per, ...(more ? { cursor: String(page.at(-1)!.name) } : {}) } });
}
// source: spec:r2-create-temp-access-credentials "Create temporary access credentials"
export async function r2_create_temp_access_credentials(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Row; const account = String(ctx.call.params.account_id);
  const jurisdiction = ctx.call.request.headers.get('cf-r2-jurisdiction') ?? 'default';
  const parent = typeof body.parentAccessKeyId === 'string' ? ctx.row(API_TOKEN, body.parentAccessKeyId) : undefined;
  const caller = bearerToken(ctx);
  const permission = String(body.permission ?? ''); const ttl = Number(body.ttlSeconds);
  if (!['admin-read-write', 'admin-read-only', 'object-read-write', 'object-read-only'].includes(permission)
    || !Number.isInteger(ttl) || ttl < 1 || ttl > 604800 || typeof body.bucket !== 'string'
    || ['objects', 'prefixes'].some(field => body[field] !== undefined && (!Array.isArray(body[field]) || (body[field] as unknown[]).some(value => typeof value !== 'string')))) return apiError(400, 10021, 'Invalid temporary credential scope.');
  if (!tokenLive(parent, ctx.occurredAt) || !caller || !personInAccount(ctx, caller, account)
    || parent._kind === 'user' && parent._owner !== caller._owner
    || !r2Grant(ctx, parent, account, jurisdiction, body.bucket, permission.endsWith('write'), permission.startsWith('admin'))) return apiError(403, 10000, 'The temporary credential cannot exceed its parent.');
  const bucket = bucketNamed(ctx, account, body.bucket);
  if (!bucket || bucket.jurisdiction !== jurisdiction) return apiError(404, 10021, 'Bucket not found.');
  const id = ctx.mint('TemporaryCredential'); const custody = await ctx.record('_credential_issue', { temporary_id: id });
  await ctx.write(TEMPORARY, id, { accessKeyId: id, account_id: account, jurisdiction, bucket: body.bucket,
    permission, objects: body.objects ?? [], prefixes: body.prefixes ?? [], parent_id: parent.id,
    expires_at: new Date(Date.parse(ctx.occurredAt) + ttl * 1000).toISOString(), _custody: custody }, 'r2.temporary.create');
  return apiOk({ accessKeyId: id, secretAccessKey: await ctx.secret(`r2-secret:${custody}`), sessionToken: await ctx.secret(`r2-session:${custody}`) });
}
// source: spec:r2-add-custom-domain "Attach Custom Domain To Bucket"
export async function r2_add_custom_domain(ctx: HandlerContext): Promise<Response> {
  const bucket = apiBucket(ctx); if (!bucket) return apiError(404, 10021, 'Bucket not found.');
  const body = (ctx.body ?? {}) as Row; const refused = domainInput(body); if (refused) return refused;
  const zone = typeof body.zoneId === 'string' ? ctx.row('zone', body.zoneId) : undefined;
  const domain = String(body.domain ?? '').toLowerCase();
  if (!zone || !sameAccount(ctx, zoneAccount(zone), bucket.account_id) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)
    || domain !== zone.name && !domain.endsWith(`.${zone.name}`)) return apiError(400, 10021, 'The custom domain must belong to a zone in this account.');
  if (ctx.rowsRaw(DOMAIN).some(row => row.domain === domain)) return apiError(409, 10021, 'Domain already attached.');
  const id = `${String(bucket.id)}:${domain}`;
  await ctx.write(DOMAIN, id, { domain, _bucket: bucket.id, zoneId: body.zoneId, zoneName: zone.name,
    enabled: body.enabled ?? true, minTLS: body.minTLS ?? '1.0', ciphers: body.ciphers ?? [],
    status: { ownership: 'pending', ssl: 'initializing' }, _target: `${bucket.name}.${bucket.account_id}.r2.cloudflarestorage.com` }, 'r2.domain.attach');
  return apiOk(publicDomain(ctx.row(DOMAIN, id)!, false, true));
}
// source: spec:r2-list-custom-domains "Gets a list of all custom domains registered with an existing R2 bucket."
export async function r2_list_custom_domains(ctx: HandlerContext): Promise<Response> {
  const bucket = apiBucket(ctx); if (!bucket) return apiError(404, 10021, 'Bucket not found.');
  return apiOk({ domains: ctx.rowsRaw(DOMAIN).filter(row => ofBucket(ctx, row._bucket, bucket) && row.deleted !== true).map(row => publicDomain(row, true)) });
}
