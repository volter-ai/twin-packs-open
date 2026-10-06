// What every family of Cloudflare's API v4 shares: its envelope, accounts, Workers scripts and their stored parts.
// The state is Cloudflare's own: a bucket this lane makes is the R2 lane's `r2_bucket`, keyed `<account>:<name>`, so
// the S3 wire serves the bucket the API made.
import { RefusedWriteError, type HandlerContext, type PerformHook, type PerformHookArgs, type WriteHookContext } from '@volter/world-core';
import { bucketNamed, accountRow, apiGrant, assetsConfigOf, sameAccount, tokenLive } from '../../../src/semantics/shared.ts';

export type Row = Record<string, unknown>;
type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'crypto'> | Pick<WriteHookContext, 'row' | 'rowsRaw' | 'crypto'>;

export const ACCOUNT = 'account';
export const SCRIPT = 'worker_script';
export const VERSION = 'worker_version';
export const DEPLOYMENT = 'worker_deployment';
export const SUBDOMAIN = 'workers_subdomain';
export const NAMESPACE = 'durable_object_namespace';
export const ASSET_SESSION = '_assets_session';
export const BUCKET = 'r2_bucket';

// ── the envelope ───────────────────────────────────────────────────────────────────────────────
// source: spec:/components/schemas/workers_api-response-common-failure "No route for the URI"

/** Cloudflare's success: `{ success, errors, messages, result }`. */
export const ok = (result: unknown, status = 200, extra: Row = {}): Response => Response.json({ success: true, errors: [], messages: [], result, ...extra }, { status });
/** Cloudflare's failure, one error with its code. */
export const fail = (status: number, code: number, message: string): Response => Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });

/** The account of a zone, in the same nested shape for API-created and imported zones. */
// source: spec:/components/schemas/zones_zone/properties/account "The account the zone belongs to."
export const zoneAccount = (zone: Row | undefined): string => String((zone?.account as Row | undefined)?.id ?? '');

// ── accounts ───────────────────────────────────────────────────────────────────────────────────

/** The account a path names, if the World holds it (the dashboard's sign-up makes it: the doors). */
export const accountOf = (ctx: Reader & { call: HandlerContext['call'] }): Row | undefined => {
  const a = accountRow(ctx as HandlerContext, String(ctx.call.params.account_id ?? ''));
  return a && a.deleted !== true ? a : undefined;
};
// Where the documentation stops: an unknown account's answer is not recorded; the code is the one Cloudflare's API
// answers a request its token cannot reach ("Could not route to /accounts/…, perhaps your object identifier is invalid?")
export const noAccount = (): Response => fail(404, 7003, 'Could not route to the account, perhaps your object identifier is invalid?');

/** A page of a list, in Cloudflare's envelope with its `result_info` (`page` from 1, `per_page` 20 unless asked, or the
 *  operation's own default). */
// source: spec:/components/schemas/iam_result_info "Total results available without any search parameters"
export function listed(ctx: Pick<HandlerContext, 'call'>, rows: unknown[], max = 50, fallback = 20): Response {
  const q = new URL(ctx.call.request.url).searchParams;
  const per = Math.min(Math.max(Number(q.get('per_page') ?? fallback) || fallback, 1), max);
  const page = Math.max(Number(q.get('page') ?? 1) || 1, 1);
  const items = rows.slice((page - 1) * per, page * per);
  return ok(items, 200, { result_info: { page, per_page: per, count: items.length, total_count: rows.length } });
}

/** The API token a request carries, as the account holds it (`api_token`, by its SHA-256, `_sha256`; the manifest's `auth.held`
 *  has refused any other), or undefined for an in-process call without one. */
export function heldToken(ctx: Pick<HandlerContext, 'call' | 'rowsRaw' | 'crypto'>): Row | undefined {
  const bearer = /^bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return undefined;
  const hash = ctx.crypto.sha256(bearer);
  return ctx.rowsRaw('api_token').find((t) => t._sha256 === hash && t.deleted !== true);
}

/** Whether a held token signs anything now: active, and not past its `expires_on` (an OAuth grant's hour). */
export const live = (t: Row, at: string): boolean => tokenLive(t, at);

/** The live API token a request carries. */
export function callerToken(ctx: Pick<HandlerContext, 'call' | 'rowsRaw' | 'crypto' | 'occurredAt'>): Row | undefined {
  const t = heldToken(ctx);
  return t && live(t, ctx.occurredAt) ? t : undefined;
}

/** An operation's need: the permission groups any one of which lets a token call it (Cloudflare's API token
 *  permissions, https://developers.cloudflare.com/fundamentals/api/reference/permissions/), and whether it acts on the
 *  account or on a zone. An operation not named needs no group beyond the token (accounts, zones, token verify). */
export function needOf(op: string, method: string): { groups: string[]; on: 'account' | 'zone' | 'user' } | undefined {
  const rw = (name: string): string[] => (method === 'GET' ? [`${name} Read`, `${name} Write`] : [`${name} Write`]);
  // a Custom Domain is attached with Workers Scripts Write (the dashboard and wrangler need the zone's Workers Routes too)
  // a zone's routes are the zone's: Workers Routes, a zone permission
  if (op.startsWith('worker-routes-')) return { groups: rw('Workers Routes'), on: 'zone' };
  if (/^worker-/.test(op) || op.startsWith('workers.domains.') || op.startsWith('durable-objects-')) return { groups: rw('Workers Scripts'), on: 'account' };
  if (op.startsWith('account-api-tokens-')) return { groups: rw('Account API Tokens'), on: 'account' };
  if (op.startsWith('accounts-turnstile-')) return { groups: rw('Turnstile'), on: 'account' };
  if (op.startsWith('r2-')) return { groups: rw('Workers R2 Storage'), on: 'account' };
  if (op.startsWith('dns-records-')) return { groups: rw('DNS'), on: 'zone' };
  if (op.startsWith('custom-hostname-')) return { groups: rw('SSL and Certificates'), on: 'zone' };
  return undefined;
}

/** Whether a token's policies allow one of the groups on the resource the request names: an allow policy with the group
 *  whose resources include the account (`com.cloudflare.api.account.<id>: "*"`), the zone
 *  (`com.cloudflare.api.account.zone.<id>`, or the zone's account over every zone, the nested
 *  `{ "com.cloudflare.api.account.<id>": { "com.cloudflare.api.account.zone.*": "*" } }`), or the token's person. */
// source: https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/ "resources"
export function allows(t: Row, groups: string[], on: { account?: string; zone?: string; zoneAccount?: string }, same?: (a: string, b: string) => boolean): boolean {
  return apiGrant(t, groups, on.account, on.zone, on.zoneAccount, same);
}

// ── scripts ────────────────────────────────────────────────────────────────────────────────────

export const scriptKey = (account: string, name: string): string => `${account}/${name}`;
/** A script's name: its stored key less its account (`<account>/<name>`), for a script the World uploaded and one a
 *  vendor-backed refresh read back alike (the list names it as its `id`). */
export const scriptNameOf = (s: Row): string => String(s.id).slice(String(s.account_id).length + 1);
/** A live script the account holds by its name, whichever of the account's ids its key was made under: a script uploaded
 *  before a deploy adopted the real account keeps the World's id in its key, and a path may name either id. */
export const scriptNamed = (ctx: Reader, account: string, name: string): Row | undefined =>
  ctx.rowsRaw(SCRIPT).find((s) => s.deleted !== true && scriptNameOf(s) === name && sameAccount(ctx as HandlerContext, s.account_id, account));
export const scriptOf = (ctx: Reader & { call: HandlerContext['call'] }): Row | undefined =>
  scriptNamed(ctx, String(ctx.call.params.account_id), String(ctx.call.params.script_name));
// source: spec:worker-script-download-worker "Download Worker Script"
export const noScript = (): Response => fail(404, 10007, 'workers.api.error.script_not_found');

/** A script as the API answers it (the list's and the upload's item). */
// source: spec:/components/schemas/workers_script-response "compatibility_date"
export function scriptView(s: Row): Row {
  return {
    id: scriptNameOf(s), tag: s.tag, etag: s.etag, handlers: s.handlers ?? ['fetch'], named_handlers: [], modified_on: s.modified_on, created_on: s.created_on,
    usage_model: 'standard', compatibility_date: s.compatibility_date ?? null, compatibility_flags: s.compatibility_flags ?? [], logpush: s.logpush === true,
    has_modules: true, has_assets: s.assets !== undefined && s.assets !== null, migration_tag: s.migration_tag ?? null, placement: s.placement ?? {}, tail_consumers: (s.tail_consumers as Row[] | null | undefined) ?? [],
    observability: s.observability ?? null, startup_time_ms: 0, tags: (s.tags as string[] | undefined) ?? [],
  };
}

/** A binding as settings show it: a secret's text never. */
export const bindingView = (b: Row): Row => (b.type === 'secret_text' ? { name: b.name, type: 'secret_text' } : b);

export const SECRET = 'worker_secret';
/** A script's secrets: one `worker_secret` subject each (`<script key>::<name>`), their text kept as `_text`. */
export const secretsOf = (ctx: Reader, script: string): Row[] => ctx.rowsRaw(SECRET).filter((x) => x._script === script && x.deleted !== true);
export async function putSecret(ctx: HandlerContext, script: string, name: string, text: string): Promise<void> {
  await ctx.write(SECRET, `${script}::${name}`, { name, type: 'secret_text', _script: script, _text: text, deleted: false }, 'worker_secret.put');
}
/** The bindings a script serves with: those its upload declared, and its secrets (names only). */
export const bindingsWith = (ctx: Reader, script: string, declared: Row[]): Row[] => [...declared.filter((b) => b.type !== 'secret_text'), ...secretsOf(ctx, script).map((x) => ({ name: x.name, type: 'secret_text' }))];

/** A version's number: its script's greatest plus one (Cloudflare numbers a script's versions in order). */
export const nextNumber = (ctx: Reader, script: string): number => ctx.rowsRaw(VERSION).filter((v) => v.script === script).reduce((n, v) => Math.max(n, Number(v.number) || 0), 0) + 1;

/** The email of the person whose token the request carries (a version's and a deployment's author). */
export const callerEmail = (ctx: Pick<HandlerContext, 'call' | 'rowsRaw' | 'crypto' | 'occurredAt'>): string | null => {
  const t = callerToken(ctx);
  return typeof t?._owner === 'string' ? t._owner : null;
};

/** A script's settings (bindings, compatibility, logpush, placement, tail consumers). */
// source: spec:worker-script-get-settings "Get Worker Script and Version Settings"
export function settingsView(ctx: Reader, s: Row): Row {
  return {
    bindings: bindingsWith(ctx, String(s.id), (s.bindings as Row[] | undefined) ?? []), compatibility_date: s.compatibility_date ?? null, compatibility_flags: s.compatibility_flags ?? [],
    limits: s.limits ?? {}, logpush: s.logpush === true, migrations: null, observability: s.observability ?? null, placement: s.placement ?? {}, tags: s.tags ?? [], tail_consumers: (s.tail_consumers as Row[] | undefined) ?? [], usage_model: 'standard',
  };
}

/** A signed asset-upload JWT naming its session and completion state, valid on the World clock. */
// source: https://developers.cloudflare.com/workers/static-assets/direct-upload/ "The JWT is valid for one hour."
// its signing key is the World's own secret (ctx.secret), which no door answers and no id the World shows derives
export const assetsJwt = async (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt' | 'secret'>, session: string, completion: boolean): Promise<string> =>
  ctx.crypto.jwtSign({ session, completion }, { alg: 'HS256', secret: await ctx.secret('workers-assets-upload-jwt') }, { now: Math.floor(Date.parse(ctx.occurredAt) / 1000), expiresInSeconds: 3600 });
/** The static assets an upload's metadata gives a version: a completion token's session manifest with its config
 *  (`_redirects` and `_headers` parsed as the API parses them), the script's own with `keep_assets`, or none. */
// source: https://developers.cloudflare.com/workers/static-assets/direct-upload/ "will contain a completion token"
export async function assetsOfUpload(ctx: Pick<HandlerContext, 'crypto' | 'occurredAt' | 'secret' | 'row' | 'rowsRaw' | 'resolve'>, metadata: Row, held: Row | undefined, account?: string): Promise<Row | null | Response> {
  const meta = metadata.assets as Row | undefined;
  if (typeof meta?.jwt === 'string') {
    const j = await jwtSession(ctx, meta.jwt);
    const session = j ? ctx.row(ASSET_SESSION, j.session) : undefined;
    if (!j || !j.completion || !session || (account !== undefined && !sameAccount(ctx as HandlerContext, session.account_id, account))) return fail(400, 10021, 'The assets completion token is not valid.');
    return { manifest: session.manifest, config: assetsConfigOf(meta.config as Row | undefined), _blobAccount: session.account_id };
  }
  return metadata.keep_assets === true && held?.assets ? { ...(held.assets as Row), _blobAccount: held._assetAccount } : null;
}

/** The vendor's asset configuration, without the transient local custody carried from its session. */
export const storedAssets = (assets: Row | null): Row | null => assets ? Object.fromEntries(Object.entries(assets).filter(([key]) => key !== '_blobAccount')) : null;

export const jwtSession = async (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt' | 'secret'>, token: string): Promise<{ session: string; completion: boolean } | undefined> => {
  const verified = ctx.crypto.jwtVerify(token, { alg: 'HS256', secret: await ctx.secret('workers-assets-upload-jwt') }, { now: Math.floor(Date.parse(ctx.occurredAt) / 1000) });
  if (!verified.valid) return undefined;
  const p = verified.payload;
  if (!p) return undefined;
  return typeof p.session === 'string' ? { session: p.session, completion: p.completion === true } : undefined;
};

/** R2's default lifecycle rule, as the R2 lane gives a bucket it makes. */
// source: https://developers.cloudflare.com/r2/buckets/object-lifecycles/ "Buckets have a default lifecycle rule to expire multipart uploads seven days after initiation."
export const DEFAULT_LIFECYCLE = [{ id: 'Default Multipart Abort Rule', enabled: true, prefix: '', abortMultipartDays: 7 }];
export { API_TOKEN, DOMAIN, TEMPORARY, bucketKey, bucketNameValid, putBucket, bearerToken, tokenLive, personInAccount, sameAccount, accountRow, bucketNamed, ofBucket, r2Grant, apiOk, apiError, publicToken } from '../../../src/semantics/shared.ts';

export function publicBucket(bucket: Row): Row {
  return Object.fromEntries(['name', 'creation_date', 'jurisdiction', 'location', 'storage_class'].filter(key => bucket[key] !== null && bucket[key] !== undefined).map(key => [key, bucket[key]]));
}
export function publicDomain(domain: Row, status: boolean, zone = false): Row {
  return Object.fromEntries(['domain', 'enabled', 'minTLS', 'ciphers', ...(status ? ['status', 'zoneId', 'zoneName'] : zone ? ['zoneId'] : [])].map(key => [key, domain[key]]));
}
export function apiBucket(ctx: HandlerContext): Row | undefined {
  const bucket = bucketNamed(ctx, String(ctx.call.params.account_id), String(ctx.call.params.bucket_name));
  return bucket && bucket.jurisdiction === (ctx.call.request.headers.get('cf-r2-jurisdiction') ?? 'default') ? bucket : undefined;
}
export function domainInput(body: Row): Response | undefined {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean'
    || body.minTLS !== undefined && !['1.0', '1.1', '1.2', '1.3'].includes(String(body.minTLS))
    || body.ciphers !== undefined && (!Array.isArray(body.ciphers) || body.ciphers.some(value => typeof value !== 'string'))) return fail(400, 10021, 'Invalid custom-domain configuration.');
  return undefined;
}

// ── the deploy of an upload with assets ────────────────────────────────────────────────────────

/** A script or version upload that carries assets, performed against the root (the manifest's `performs`): the World's
 *  completion token means nothing to Cloudflare, so the upload session is opened again with the manifest the World's
 *  session held, the files Cloudflare asks for are uploaded from the World's blob store with the JWT it issued, and the
 *  recorded upload is sent with the completion token it answers. An upload without assets is the recorded request. */
// source: https://developers.cloudflare.com/workers/static-assets/direct-upload/ "will contain a completion token"
export async function uploadWithAssets(a: PerformHookArgs): ReturnType<PerformHook> {
  const body = (a.input.body ?? {}) as Row;
  let meta: Row;
  try { meta = JSON.parse(String(body.metadata ?? '{}')) as Row; } catch { return a.send(a.input); }
  const assets = meta.assets as Row | undefined;
  if (typeof assets?.jwt !== 'string') return a.send(a.input);
  const first = a.group[0]!.id;
  const params = (a.input.path ?? {}) as Record<string, string>;
  const worldAccount = String(params.account_id);
  const base = `${a.basePath}/accounts/${encodeURIComponent(a.resolve(ACCOUNT, worldAccount))}`;
  const assetEntry = a.localGroup.find((e) => { const assets = e.fields?.assets as Row | undefined; return assets && typeof assets.manifest === 'object'; });
  const held = assetEntry?.fields?.assets as Row | undefined;
  if (!held) throw new RefusedWriteError('vendor', 'the upload names assets the World holds no manifest of', first);
  // Blob custody is the upload session's local account, independent of the root's adopted account.
  // Older recorded uploads carry that owner on their script effect or version's script key.
  const script = a.localGroup.find((e) => e.subject.type === SCRIPT);
  const version = a.localGroup.find((e) => e.subject.type === VERSION);
  const blobAccount = assetEntry?.fields?._assetAccount ?? script?.fields?.account_id ?? (typeof version?.fields?.script === 'string' ? version.fields.script.split('/')[0] : undefined);
  if (typeof blobAccount !== 'string' || !blobAccount) throw new RefusedWriteError('vendor', 'the upload holds no local asset account', first);
  const read = (r: { body: string }): Row => { try { return JSON.parse(r.body) as Row; } catch { return {}; } };
  const refused = (r: { status: number; body: string }, what: string): never => {
    const words = ((read(r).errors as Row[] | undefined)?.[0]?.message as string | undefined) ?? r.body.slice(0, 200);
    if (r.status === 408 || r.status === 429 || r.status >= 500) throw new Error(`${r.status}: ${what}: ${words}`);
    throw new RefusedWriteError('vendor', `${r.status}: ${what}: ${words}`, first);
  };
  const session = await a.execute({ method: 'POST', path: `${base}/workers/scripts/${encodeURIComponent(String(params.script_name))}/assets-upload-session`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest: held.manifest }) });
  if (session.status >= 300) refused(session, 'the assets upload session');
  const opened = read(session).result as { jwt: string; buckets: string[][] };
  let completion = opened.buckets.length ? '' : opened.jwt;
  for (const bucket of opened.buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const bytes = await a.blob(`asset/${blobAccount}/${hash}`);
      if (!bytes) throw new RefusedWriteError('vendor', `the asset ${hash} is not in the World's blob store`, first);
      const type = await a.blob(`asset-type/${blobAccount}/${hash}`);
      form.append(hash, new File([Buffer.from(bytes).toString('base64')], hash, { type: type ? new TextDecoder().decode(type) : 'application/null' }));
    }
    const encoded = new Response(form);
    const sent = await a.execute({ method: 'POST', path: `${base}/workers/assets/upload?base64=true`, headers: { 'content-type': encoded.headers.get('content-type') ?? '' }, body: new Uint8Array(await encoded.arrayBuffer()), issued: `Bearer ${opened.jwt}` });
    if (sent.status >= 300) refused(sent, 'an assets upload');
    const token = (read(sent).result as Row | undefined)?.jwt;
    if (typeof token === 'string' && token) completion = token;
  }
  if (!completion) throw new Error('the assets upload ended with no completion token');
  return a.send({ ...a.input, body: { ...body, metadata: JSON.stringify({ ...meta, assets: { ...assets, jwt: completion } }) } });
}

/** Cloudflare's five-field cron grammar, including its documented Quartz-style day selectors. */
// source: https://developers.cloudflare.com/workers/configuration/cron-triggers/ "Cloudflare supports cron expressions with five fields"
// source: https://developers.cloudflare.com/workers/configuration/cron-triggers/ "0-59"
// source: https://developers.cloudflare.com/workers/configuration/cron-triggers/ "1-7"
// source: https://raw.githubusercontent.com/cloudflare/saffron/main/saffron/src/parse.rs "const MAX: u8 = E::MAX - E::MIN;"
export function validCron(expression: string): boolean {
  if (/[\r\n]/.test(expression)) return false;
  const fields = expression.trim().split(/[ \t]+/);
  if (fields.length !== 5) return false;
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [1, 7]] as const;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return fields.every((field, index) => {
    const [min, max] = bounds[index]!;
    const value = (text: string): number | undefined => {
      const named = index === 3 ? months.indexOf(text.toUpperCase()) : index === 4 ? weekdays.indexOf(text.toUpperCase()) : -1;
      const n = named >= 0 ? named + 1 : /^\d+$/.test(text) ? Number(text) : NaN;
      return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
    };
    // L/W/# expressions select a single day; they cannot be combined with a list or a step.
    if (index === 2) {
      if (field === 'L' || field === 'LW') return true;
      const offset = /^L-(\d+)(W)?$/.exec(field);
      if (offset) return Number(offset[1]) >= 1 && Number(offset[1]) <= 30;
      const weekday = /^(\d+)W$/.exec(field);
      if (weekday) return value(weekday[1]!) !== undefined;
    }
    if (index === 4) {
      if (field === 'L') return true;
      const last = /^([A-Za-z]{3}|\d+)L$/.exec(field);
      if (last) return value(last[1]!) !== undefined;
      const nth = /^([A-Za-z]{3}|\d+)#(\d+)$/.exec(field);
      if (nth) return value(nth[1]!) !== undefined && Number(nth[2]) >= 1 && Number(nth[2]) <= 5;
    }
    if (field === '*') return true;
    // The vendor parser consumes a leading '*' alone unless followed by a step.
    if (field.startsWith('*,') || field.startsWith('*-')) return false;
    return field.split(',').every((part) => {
      const pieces = part.split('/');
      if (pieces.length > 2) return false;
      const [range, step] = pieces;
      if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1 || Number(step) > max - min)) return false;
      if (range === '*') return true;
      const ends = range!.split('-');
      if (ends.length > 2) return false;
      // Saffron accepts wrapped ranges as well as increasing ranges; both endpoints still obey their field bounds.
      return ends.every((end) => value(end) !== undefined);
    });
  });
}

// source: spec:/components/schemas/workers_binding_item "A binding to allow the Worker to communicate with resources."
// Required fields of the discriminator variants in the retained schema, checked before any upload writes.
const BINDING_REQUIRED: Record<string, readonly string[]> = {
  "ai": [
    "name",
    "type"
  ],
  "ai_search": [
    "name",
    "type",
    "instance_name"
  ],
  "ai_search_namespace": [
    "name",
    "type",
    "namespace"
  ],
  "analytics_engine": [
    "name",
    "type",
    "dataset"
  ],
  "assets": [
    "name",
    "type"
  ],
  "browser": [
    "name",
    "type"
  ],
  "d1": [
    "name",
    "type",
    "database_id"
  ],
  "data_blob": [
    "name",
    "type",
    "part"
  ],
  "dispatch_namespace": [
    "name",
    "type",
    "namespace"
  ],
  "durable_object_namespace": [
    "name",
    "type"
  ],
  "flagship": [
    "name",
    "type",
    "app_id"
  ],
  "hyperdrive": [
    "name",
    "type",
    "id"
  ],
  "images": [
    "name",
    "type"
  ],
  "inherit": [
    "name",
    "type"
  ],
  "json": [
    "name",
    "type",
    "json"
  ],
  "k2": [
    "name",
    "type",
    "stream"
  ],
  "kv_namespace": [
    "name",
    "type",
    "namespace_id"
  ],
  "media": [
    "name",
    "type"
  ],
  "messaging": [
    "name",
    "type",
    "namespace"
  ],
  "mtls_certificate": [
    "name",
    "type",
    "certificate_id"
  ],
  "pipelines": [
    "name",
    "type",
    "pipeline"
  ],
  "plain_text": [
    "name",
    "type",
    "text"
  ],
  "queue": [
    "name",
    "type",
    "queue_name"
  ],
  "r2_bucket": [
    "name",
    "type",
    "bucket_name"
  ],
  "ratelimit": [
    "name",
    "type",
    "namespace_id",
    "simple"
  ],
  "secret_key": [
    "name",
    "type",
    "format",
    "algorithm",
    "usages"
  ],
  "secret_text": [
    "name",
    "type",
    "text"
  ],
  "secrets_store_secret": [
    "name",
    "type",
    "store_id",
    "secret_name"
  ],
  "send_email": [
    "name",
    "type"
  ],
  "service": [
    "name",
    "type",
    "service"
  ],
  "text_blob": [
    "name",
    "type",
    "part"
  ],
  "vectorize": [
    "name",
    "type",
    "index_name"
  ],
  "version_metadata": [
    "name",
    "type"
  ],
  "vpc_network": [
    "name",
    "type"
  ],
  "vpc_service": [
    "name",
    "type",
    "service_id"
  ],
  "wasm_module": [
    "name",
    "type",
    "part"
  ],
  "workflow": [
    "name",
    "type",
    "workflow_name"
  ]
};

export function requiredUploadBindings(metadata: Row): Response | undefined {
  if (metadata.bindings === undefined) return undefined;
  // source: spec:/components/schemas/workers_bindings "List of bindings attached to a Worker."
  if (!Array.isArray(metadata.bindings)) return fail(400, 10021, "bindings must be a list.");
  for (const binding of metadata.bindings as Row[]) {
    const fields = binding && BINDING_REQUIRED[String(binding.type)];
    // Where the documentation stops: the validation code is documented; its missing-field wording is not.
    // source: https://developers.cloudflare.com/workers/observability/errors/ "Validation Error. Refer to Validation Errors for details."
    if (!fields || fields.some((field) => binding[field] === undefined)) return fail(400, 10021, "A binding is missing its required fields.");
  }
  return undefined;
}

// The numeric constraints of the DNS record variants in the retained request union.
const DNS_NUMERIC_BOUNDS: Record<string, ReadonlyArray<readonly [string, number, number]>> = {
  // source: spec:/components/schemas/dns-records_CAARecord/allOf/1/properties/data/properties/flags "Flags for the CAA record."
  "CAA": [["data.flags", 0, 255]],
  // source: spec:/components/schemas/dns-records_CERTRecord/allOf/1/properties/data/properties/algorithm "Algorithm."
  // source: spec:/components/schemas/dns-records_CERTRecord/allOf/1/properties/data/properties/key_tag "Key Tag."
  // source: spec:/components/schemas/dns-records_CERTRecord/allOf/1/properties/data/properties/type "Type."
  "CERT": [["data.algorithm", 0, 255], ["data.key_tag", 0, 65535], ["data.type", 0, 65535]],
  // source: spec:/components/schemas/dns-records_DNSKEYRecord/allOf/1/properties/data/properties/algorithm "Algorithm."
  // source: spec:/components/schemas/dns-records_DNSKEYRecord/allOf/1/properties/data/properties/flags "Flags."
  // source: spec:/components/schemas/dns-records_DNSKEYRecord/allOf/1/properties/data/properties/protocol "Protocol."
  "DNSKEY": [["data.algorithm", 0, 255], ["data.flags", 0, 65535], ["data.protocol", 0, 255]],
  // source: spec:/components/schemas/dns-records_DSRecord/allOf/1/properties/data/properties/algorithm "Algorithm."
  // source: spec:/components/schemas/dns-records_DSRecord/allOf/1/properties/data/properties/digest_type "Digest Type."
  // source: spec:/components/schemas/dns-records_DSRecord/allOf/1/properties/data/properties/key_tag "Key Tag."
  "DS": [["data.algorithm", 0, 255], ["data.digest_type", 0, 255], ["data.key_tag", 0, 65535]],
  // source: spec:/components/schemas/dns-records_HTTPSRecord/allOf/1/properties/data/properties/priority "Priority."
  "HTTPS": [["data.priority", 0, 65535]],
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/altitude "Altitude of location in meters."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/lat_degrees "Degrees of latitude."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/lat_minutes "Minutes of latitude."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/lat_seconds "Seconds of latitude."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/long_degrees "Degrees of longitude."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/long_minutes "Minutes of longitude."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/long_seconds "Seconds of longitude."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/precision_horz "Horizontal precision of location."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/precision_vert "Vertical precision of location."
  // source: spec:/components/schemas/dns-records_LOCRecord/allOf/1/properties/data/properties/size "Size of location in meters."
  "LOC": [["data.altitude", -100000, 42849672.95], ["data.lat_degrees", 0, 90], ["data.lat_minutes", 0, 59], ["data.lat_seconds", 0, 59.999], ["data.long_degrees", 0, 180], ["data.long_minutes", 0, 59], ["data.long_seconds", 0, 59.999], ["data.precision_horz", 0, 90000000], ["data.precision_vert", 0, 90000000], ["data.size", 0, 90000000]],
  // source: spec:/components/schemas/dns-records_priority "Required for MX and URI records; ignored for other record types (but may still be returned by the API). Records with lower priorities are preferred. This field is to be deprecated in favor of the priority field within the data map."
  "MX": [["priority", 0, 65535]],
  // source: spec:/components/schemas/dns-records_NAPTRRecord/allOf/1/properties/data/properties/order "Order."
  // source: spec:/components/schemas/dns-records_NAPTRRecord/allOf/1/properties/data/properties/preference "Preference."
  "NAPTR": [["data.order", 0, 65535], ["data.preference", 0, 65535]],
  // source: spec:/components/schemas/dns-records_SMIMEARecord/allOf/1/properties/data/properties/matching_type "Matching Type."
  // source: spec:/components/schemas/dns-records_SMIMEARecord/allOf/1/properties/data/properties/selector "Selector."
  // source: spec:/components/schemas/dns-records_SMIMEARecord/allOf/1/properties/data/properties/usage "Usage."
  "SMIMEA": [["data.matching_type", 0, 255], ["data.selector", 0, 255], ["data.usage", 0, 255]],
  // source: spec:/components/schemas/dns-records_SRVRecord/allOf/1/properties/data/properties/port "The port of the service."
  // source: spec:/components/schemas/dns-records_priority "Required for MX and URI records; ignored for other record types (but may still be returned by the API). Records with lower priorities are preferred. This field is to be deprecated in favor of the priority field within the data map."
  // source: spec:/components/schemas/dns-records_SRVRecord/allOf/1/properties/data/properties/weight "The record weight."
  "SRV": [["data.port", 0, 65535], ["data.priority", 0, 65535], ["data.weight", 0, 65535]],
  // source: spec:/components/schemas/dns-records_SSHFPRecord/allOf/1/properties/data/properties/algorithm "Algorithm."
  // source: spec:/components/schemas/dns-records_SSHFPRecord/allOf/1/properties/data/properties/type "Type."
  "SSHFP": [["data.algorithm", 0, 255], ["data.type", 0, 255]],
  // source: spec:/components/schemas/dns-records_SVCBRecord/allOf/1/properties/data/properties/priority "Priority."
  "SVCB": [["data.priority", 0, 65535]],
  // source: spec:/components/schemas/dns-records_TLSARecord/allOf/1/properties/data/properties/matching_type "Matching Type."
  // source: spec:/components/schemas/dns-records_TLSARecord/allOf/1/properties/data/properties/selector "Selector."
  // source: spec:/components/schemas/dns-records_TLSARecord/allOf/1/properties/data/properties/usage "Usage."
  "TLSA": [["data.matching_type", 0, 255], ["data.selector", 0, 255], ["data.usage", 0, 255]],
  // source: spec:/components/schemas/dns-records_URIRecord/allOf/1/properties/data/properties/weight "The record weight."
  // source: spec:/components/schemas/dns-records_priority "Required for MX and URI records; ignored for other record types (but may still be returned by the API). Records with lower priorities are preferred. This field is to be deprecated in favor of the priority field within the data map."
  "URI": [["data.weight", 0, 65535], ["priority", 0, 65535]],
};

export function dnsNumericBounds(ctx: Pick<HandlerContext, 'row' | 'call'>, body: Row): Response | undefined {
  // source: spec:/components/schemas/dns-records_ttl "Value must be between 60 and 86400, with the minimum reduced to 30 for Enterprise zones."
  const zone = ctx.row('zone', String(ctx.call.params.zone_id));
  const minimum = (zone?.plan as Row | undefined)?.name === 'Enterprise' ? 30 : 60;
  // source: spec:/components/schemas/dns-records_ttl "Setting to 1 means 'automatic'."
  const ttl = body.ttl;
  const invalidTTL = ttl !== undefined && ttl !== 1 && (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < minimum || ttl > 86400);
  const invalidField = (DNS_NUMERIC_BOUNDS[String(body.type)] ?? []).some(([path, min, max]) => {
    const value = path.split('.').reduce<unknown>((at, field) => at && typeof at === 'object' ? (at as Row)[field] : undefined, body);
    return value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max);
  });
  // source: https://raw.githubusercontent.com/cloudflare/python-cloudflare-cli4/main/README.md "1004 DNS Validation Error"
  // Where the documentation stops: numeric-field-specific error chains are not recorded; answer the vendor's documented DNS validation error.
  return invalidTTL || invalidField ? fail(400, 1004, 'DNS Validation Error') : undefined;
}
