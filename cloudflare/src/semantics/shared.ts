// Cloudflare's shared identity/credential model, authored for c4 from the API token and R2 references.
// Both lanes read these same vendor subjects; no lane imports another lane's implementation.
import { digest, type HandlerContext } from '@volter/world-core';
export type Row = Record<string, unknown>;
export const API_TOKEN = 'api_token';
export const BUCKET = 'r2_bucket';
export const OBJECT = 'r2_object';
export const UPLOAD = 'r2_multipart';
export const PART = 'r2_part';
export const DOMAIN = 'r2_custom_domain';
export const TEMPORARY = 'r2_temporary_credential';

export const apiOk = (result: unknown, status = 200, extra: Row = {}): Response =>
  Response.json({ success: true, errors: [], messages: [], result, ...extra }, { status });
export const apiError = (status: number, code: number, message: string): Response =>
  Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });

// Where the reference does not publish a group's stable id, the World gives it a consistent synthetic opaque id.
// The permission-group API returns this mapping; callers must use its returned ids rather than an assumed hash.
// source: https://developers.cloudflare.com/r2/api/tokens/ "6a018a9f2fc74eb6b293b0c548f38b39"
const PUBLISHED_GROUP_IDS: Record<string, string> = { 'Workers R2 Storage Bucket Item Read': '6a018a9f2fc74eb6b293b0c548f38b39' };
export const groupRef = (name: string): Row => ({ id: PUBLISHED_GROUP_IDS[name] ?? digest('sha256', `cloudflare-permission:${name}`).slice(0, 32), name });
export const PERMISSION_NAMES = [
  'API Tokens Read', 'API Tokens Write', 'Account API Tokens Read', 'Account API Tokens Write',
  'Account Settings Read', 'Account Settings Write', 'User Details Read', 'User Details Write',
  'Memberships Read', 'Memberships Write', 'Workers Scripts Read', 'Workers Scripts Write', 'Workers Tail Read',
  'Workers R2 Storage Read', 'Workers R2 Storage Write', 'Workers R2 Storage Bucket Item Read',
  'Workers R2 Storage Bucket Item Write', 'Zone Read', 'Zone Write', 'DNS Read', 'DNS Write', 'Workers Routes Read', 'Workers Routes Write',
  'SSL and Certificates Read', 'SSL and Certificates Write', 'Turnstile Read', 'Turnstile Write',
];
export const permissionGroups = (): Row[] => PERMISSION_NAMES.map(groupRef);
export type R2Permission = 'admin-rw' | 'admin-ro' | 'object-rw' | 'object-ro';

// source: https://developers.cloudflare.com/r2/api/tokens/ "permission groups"
export function r2Policy(account: string, permission: R2Permission, bucket: string, jurisdiction = 'default'): Row {
  const admin = permission.startsWith('admin');
  const names = admin ? ['Workers R2 Storage Read'] : ['Workers R2 Storage Bucket Item Read'];
  if (permission.endsWith('rw')) names.push(admin ? 'Workers R2 Storage Write' : 'Workers R2 Storage Bucket Item Write');
  const resources = admin ? { [`com.cloudflare.api.account.${account}`]: '*' }
    : bucket === '*' ? { [`com.cloudflare.api.account.${account}`]: { 'com.cloudflare.edge.r2.bucket.*': '*' } }
      : { [`com.cloudflare.edge.r2.bucket.${account}_${jurisdiction}_${bucket}`]: '*' };
  return { id: digest('sha256', `r2-policy:${account}:${jurisdiction}:${bucket}:${permission}`).slice(0, 32), effect: 'allow', resources, permission_groups: names.map(groupRef) };
}

export function publicToken(ctx: HandlerContext, token: Row): Row {
  const own = ctx.own(token);
  return Object.fromEntries(Object.entries(own).filter(([key]) => !key.startsWith('_') && key !== 'value' && key !== 'deleted'));
}

/** A token's value in Cloudflare's scannable format: a user token's prefix `cfut_`, an account's `cfat_`. */
// source: https://developers.cloudflare.com/fundamentals/api/get-started/token-formats/ "Every new token you create or roll uses the scannable format automatically."
const tokenFormat = (kind: unknown, secret: string): string => `${kind === 'account' ? 'cfat_' : 'cfut_'}${secret}`;
export async function apiTokenValue(ctx: HandlerContext, id: string): Promise<string | undefined> {
  const token = ctx.row(API_TOKEN, id);
  if (!token || typeof token._custody !== 'string') return undefined;
  return tokenFormat(token._kind, await ctx.secret(`cloudflare-api-token:${token._custody}`));
}
export async function makeApiToken(ctx: HandlerContext, input: {
  name: string; kind: 'account' | 'user'; owner: string; account?: string; policies: Row[];
  expires_on?: string; not_before?: string;
}): Promise<{ token: Row; value: string }> {
  const id = ctx.mint('ApiToken');
  const serial = await ctx.record('_credential_issue', { token_id: id });
  const value = tokenFormat(input.kind, await ctx.secret(`cloudflare-api-token:${serial}`));
  // source: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ "The token secret is only shown once"
  await ctx.write(API_TOKEN, id, {
    id, name: input.name, policies: input.policies, status: 'active', issued_on: ctx.occurredAt,
    modified_on: ctx.occurredAt, ...(input.expires_on ? { expires_on: input.expires_on } : {}),
    ...(input.not_before ? { not_before: input.not_before } : {}),
    _kind: input.kind, _owner: input.owner, _account: input.account ?? null,
    _user: ctx.rowsRaw('cf_user').find(user => user.email === input.owner)?.id ?? null, _custody: serial,
    _sha256: ctx.crypto.sha256(value), deleted: false,
  }, 'api_token.create');
  return { token: ctx.row(API_TOKEN, id)!, value };
}
export async function rollApiToken(ctx: HandlerContext, token: Row): Promise<string> {
  const serial = await ctx.record('_credential_issue', { token_id: token.id });
  const value = tokenFormat(token._kind, await ctx.secret(`cloudflare-api-token:${serial}`));
  await ctx.write(API_TOKEN, String(token.id), { _custody: serial, _sha256: ctx.crypto.sha256(value), modified_on: ctx.occurredAt }, 'api_token.roll');
  return value;
}
export function tokenLive(token: Row | undefined, at: string): token is Row {
  if (!token || token.deleted === true || token.status !== 'active') return false;
  const now = Date.parse(at);
  return !(typeof token.expires_on === 'string' && Date.parse(token.expires_on) <= now)
    && !(typeof token.not_before === 'string' && Date.parse(token.not_before) > now);
}
/** Whether two ids name one account: the World's own, and the real account's once a deploy adopted it. A stored row
 *  names the adopted id; a path, a host or a door's derivation the World handed out may still name its own. */
export function sameAccount(ctx: Pick<HandlerContext, 'resolve'>, a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && (a === b || ctx.resolve('account', a) === ctx.resolve('account', b));
}
/** The account an id names, by either of its ids: a deploy that adopted the real account keeps it under the real id. */
export function accountRow(ctx: Pick<HandlerContext, 'resolve' | 'row'>, id: string): Row | undefined {
  return ctx.row('account', ctx.resolve('account', id)) ?? ctx.row('account', id);
}
export function personInAccount(ctx: HandlerContext, token: Row, account: string): boolean {
  if (token._kind === 'account') return sameAccount(ctx, token._account, account);
  // source: https://developers.cloudflare.com/r2/api/tokens/ "They inherit your personal permissions"
  return ctx.rowsRaw('account_member').some(member => member.email === token._owner && sameAccount(ctx, member.account_id, account) && member.status === 'accepted');
}
export function groupsIn(policy: Row): string[] {
  return ((policy.permission_groups ?? []) as Row[]).map(group => {
    const known = permissionGroups().find(entry => entry.id === group.id);
    return typeof known?.name === 'string' ? known.name : typeof group.name === 'string' ? group.name : '';
  });
}
export function apiGrant(token: Row, names: string[], account?: string, zone?: string, zoneAccount?: string,
  same: (a: string, b: string) => boolean = (a, b) => a === b): boolean {
  const applicable = ((token.policies ?? []) as Row[]).filter(policy => {
    if (!groupsIn(policy).some(name => names.includes(name))) return false;
    const resources = (policy.resources ?? {}) as Row;
    // an account's resource, named by either of its ids (a policy written before a deploy adopted the account names the World's)
    const onAccount = (id: string): unknown[] => Object.entries(resources).filter(([key]) => key.startsWith('com.cloudflare.api.account.')
      && !key.startsWith('com.cloudflare.api.account.zone.') && same(key.slice('com.cloudflare.api.account.'.length), id)).map(([, value]) => value);
    if (zone && resources[`com.cloudflare.api.account.zone.${zone}`] === '*') return true;
    if (zone && zoneAccount && onAccount(zoneAccount).some(parent => parent && typeof parent === 'object' && (parent as Row)['com.cloudflare.api.account.zone.*'] === '*')) return true;
    if (account && onAccount(account).includes('*')) return true;
    return !account && !zone && (resources['com.cloudflare.api.user.*'] === '*'
      || typeof token._user === 'string' && resources[`com.cloudflare.api.user.${token._user}`] === '*');
  });
  return !applicable.some(policy => policy.effect === 'deny') && applicable.some(policy => policy.effect === 'allow');
}
export function r2Grant(ctx: HandlerContext, token: Row, account: string, jurisdiction: string, bucket: string | undefined,
  mutation: boolean, administration: boolean): boolean {
  if (!tokenLive(token, ctx.occurredAt) || !personInAccount(ctx, token, account)) return false;
  const applicable = ((token.policies ?? []) as Row[]).filter(policy => {
    const names = groupsIn(policy);
    const administrative = names.includes(mutation ? 'Workers R2 Storage Write' : 'Workers R2 Storage Read')
      || (!mutation && names.includes('Workers R2 Storage Write'));
    const objectAccess = !administration && (names.includes(mutation ? 'Workers R2 Storage Bucket Item Write' : 'Workers R2 Storage Bucket Item Read')
      || (!mutation && names.includes('Workers R2 Storage Bucket Item Write')));
    const resources = (policy.resources ?? {}) as Row;
    // the account's resources, named under either of its ids (a policy made before a deploy adopted the account names the World's)
    const ons = Object.entries(resources).filter(([key]) => key.startsWith('com.cloudflare.api.account.') && !key.startsWith('com.cloudflare.api.account.zone.')
      && sameAccount(ctx, key.slice('com.cloudflare.api.account.'.length), account)).map(([, value]) => value);
    if (administrative && ons.includes('*')) return true;
    if (!objectAccess || !bucket) return false;
    const suffix = `_${jurisdiction}_${bucket}`;
    if (Object.entries(resources).some(([key, value]) => value === '*' && key.startsWith('com.cloudflare.edge.r2.bucket.') && key.endsWith(suffix)
      && sameAccount(ctx, key.slice('com.cloudflare.edge.r2.bucket.'.length, -suffix.length), account))) return true;
    return ons.some(on => !!on && typeof on === 'object' && (on as Row)['com.cloudflare.edge.r2.bucket.*'] === '*');
  });
  return !applicable.some(policy => policy.effect === 'deny') && applicable.some(policy => policy.effect === 'allow');
}

export function bucketKey(account: string, name: string): string { return `${account}:${name}`; }
export function objectKey(account: string, bucket: string, key: string): string { return `${account}:${bucket}/${key}`; }
/** A live bucket the account holds by its name, whichever of the account's ids its key was made under. */
export function bucketNamed(ctx: Pick<HandlerContext, 'resolve' | 'rowsRaw'>, account: string, name: string): Row | undefined {
  return ctx.rowsRaw(BUCKET).find(bucket => bucket.deleted !== true && bucket.name === name && sameAccount(ctx, bucket.account_id, account));
}
/** The account a bucket's own key was made under, which its objects are kept under: it never changes, as the id the
 *  bucket names its account by does once a deploy adopted the account. */
export const bucketAccount = (bucket: Row): string => String(bucket.id).slice(0, String(bucket.id).length - String(bucket.name).length - 1);
/** Whether a row's parent field names this bucket: by its own key, or by the key a vendor-backed refresh gives it, under
 *  the account's adopted id. */
export function ofBucket(ctx: Pick<HandlerContext, 'resolve'>, parent: unknown, bucket: Row): boolean {
  return parent === bucket.id || parent === `${ctx.resolve('account', bucketAccount(bucket))}:${String(bucket.name)}`;
}
export const DEFAULT_LIFECYCLE = [{ id: 'Default Multipart Abort Rule', enabled: true, prefix: '', abortMultipartDays: 7 }];
export function bucketNameValid(name: string): boolean {
  // source: https://developers.cloudflare.com/r2/buckets/create-buckets/ "Bucket names can only be between 3-63 characters in length"
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name);
}
export async function putBucket(ctx: HandlerContext, account: string, name: string, jurisdiction: string,
  location: string | null, storageClass = 'Standard'): Promise<void> {
  await ctx.write(BUCKET, bucketKey(account, name), {
    account_id: account, name, creation_date: ctx.occurredAt, jurisdiction, location,
    storage_class: storageClass, lifecycle: DEFAULT_LIFECYCLE, deleted: false,
  }, 'r2_bucket.create');
}

export function bearerToken(ctx: HandlerContext): Row | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return undefined;
  const hash = ctx.crypto.sha256(bearer);
  return ctx.rowsRaw(API_TOKEN).find(token => token._sha256 === hash && token.deleted !== true);
}
// ── a Worker's static assets ───────────────────────────────────────────────────────────────────
// A Worker's static assets as Cloudflare serves them at the Worker's hostnames: `_redirects` and `_headers` parsed as the
// API parses the text wrangler uploads, and a request answered as the asset worker answers it (redirects first, then
// html_handling, then not_found_handling, the asset's ETag and content type, then the custom headers). Ported from
// Cloudflare's own code, workers-sdk's `packages/workers-shared` (MIT OR Apache-2.0): the parsers from
// `utils/configuration/{parseRedirects,parseHeaders,validateURL,constructConfiguration}.ts` and the serving from
// `asset-worker/src/{handler,utils/rules-engine,utils/headers}.ts`, as miniflare 5.20260921.0 and wrangler 4.137.0 ship
// them.
// source: https://developers.cloudflare.com/workers/static-assets/redirects/ "A _redirects file is limited to 2,000 static redirects and 100 dynamic redirects"
const MAX_STATIC_REDIRECT_RULES = 2000;
const MAX_DYNAMIC_REDIRECT_RULES = 100;
const MAX_HEADER_RULES = 100;
const MAX_LINE_LENGTH = 2000;
const PERMITTED_STATUS_CODES = new Set([200, 301, 302, 303, 307, 308]);
const SPLAT_REGEX = /\*/g;
const PLACEHOLDER_REGEX = /:[A-Za-z]\w*/g;
const URL_REGEX = /^https:\/\/+(?<host>[^/]+)\/?(?<path>.*)/;
const HOST_WITH_PORT_REGEX = /.*:\d+$/;
const LINE_IS_PROBABLY_A_PATH = /^([^\s]+:\/\/|^\/)/;
// source: https://developers.cloudflare.com/workers/static-assets/headers/ "Default headers"
const CACHE_CONTROL_BROWSER = 'public, max-age=0, must-revalidate';

export type Redirects = { version: 1; staticRules: Record<string, { status: number; to: string; lineNumber: number }>; rules: Record<string, { status: number; to: string }> };
export type Headers_ = { version: 2; rules: Record<string, { set?: Record<string, string>; unset?: string[] }> };
export type AssetsConfig = { html_handling?: string; not_found_handling?: string; redirects?: Redirects; headers?: Headers_ };

const extractPathname = (path = '/', search: boolean, hash: boolean): string => {
  if (!path.startsWith('/')) path = `/${path}`;
  const url = new URL(`//${path}`, 'relative://');
  return `${url.pathname}${search ? url.search : ''}${hash ? url.hash : ''}`;
};
function validateUrl(token: string, onlyRelative = false, disallowPorts = false, search = false, hash = false): string | undefined {
  const host = URL_REGEX.exec(token);
  if (host?.groups?.host) {
    if (onlyRelative || (disallowPorts && HOST_WITH_PORT_REGEX.test(host.groups.host))) return undefined;
    return `https://${host.groups.host}${extractPathname(host.groups.path, search, hash)}`;
  }
  if (!token.startsWith('/') && onlyRelative) token = `/${token}`;
  if (!token.startsWith('/')) return undefined;
  try { return extractPathname(token, search, hash); } catch { return undefined; }
}
const hasHost = (token: string): boolean => Boolean(URL_REGEX.exec(token)?.groups?.host);

/** A `_redirects` file's text as the configuration the asset worker reads, or undefined when no rule is valid. */
// source: https://developers.cloudflare.com/workers/static-assets/redirects/ "Only one redirect can be defined per line and must follow this format, otherwise it will be ignored."
export function parseRedirects(input: string, htmlHandling?: string): Redirects | undefined {
  const rules: Array<{ from: string; to: string; status: number; lineNumber: number }> = [];
  const seen = new Set<string>();
  let statics = 0, dynamics = 0, canStatic = true;
  const lines = input.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line || line.startsWith('#') || line.length > MAX_LINE_LENGTH) continue;
    const tokens = line.replace(/\s+#.*$/, '').split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3) continue;
    const [rawFrom, rawTo, rawStatus = '302'] = tokens as [string, string, string?];
    const from = validateUrl(rawFrom, true, true);
    if (from === undefined) continue;
    if (canStatic && !from.match(SPLAT_REGEX) && !from.match(PLACEHOLDER_REGEX)) {
      if (++statics > MAX_STATIC_REDIRECT_RULES) continue;
    } else {
      canStatic = false;
      if (++dynamics > MAX_DYNAMIC_REDIRECT_RULES) break;
    }
    const to = validateUrl(rawTo, false, false, true, true);
    const status = Number(rawStatus);
    if (to === undefined || !PERMITTED_STATUS_CODES.has(status)) continue;
    const relative = !hasHost(to);
    const loops = (from.endsWith('/*') && /\/index(.html)?$/.test(to)) || (from.endsWith('/') && /\/index(.html)?$/.test(to) && htmlHandling !== 'none');
    if ((relative && loops) || seen.has(from) || (status === 200 && !relative)) continue;
    seen.add(from);
    rules.push({ from, to, status, lineNumber: i + 1 });
  }
  if (!rules.length) return undefined;
  const out: Redirects = { version: 1, staticRules: {}, rules: {} };
  canStatic = true;
  for (const r of rules) {
    if (!r.from.match(SPLAT_REGEX) && !r.from.match(PLACEHOLDER_REGEX) && canStatic) { out.staticRules[r.from] = { status: r.status, to: r.to, lineNumber: r.lineNumber }; continue; }
    out.rules[r.from] = { status: r.status, to: r.to };
    canStatic = false;
  }
  return out;
}

/** A `_headers` file's text as the configuration the asset worker reads, or undefined when no rule is valid. */
// source: https://developers.cloudflare.com/workers/static-assets/headers/ "Header rules are defined in multi-line blocks."
export function parseHeaders(input: string): Headers_ | undefined {
  const rules: Array<{ path: string; headers: Record<string, string>; unset: string[] }> = [];
  let rule: { path: string; headers: Record<string, string>; unset: string[] } | undefined;
  let skip = false;
  const push = (): void => { if (rule && (Object.keys(rule.headers).length || rule.unset.length)) rules.push(rule); };
  for (const raw of input.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.length > MAX_LINE_LENGTH) continue;
    if (LINE_IS_PROBABLY_A_PATH.test(line)) {
      skip = false;
      if (rules.length >= MAX_HEADER_RULES) break;
      push();
      const path = validateUrl(line, false, true);
      const splats = (path?.match(SPLAT_REGEX) ?? []).length;
      if (path === undefined || splats > 1 || (splats > 0 && /:splat(?!\w)/.test(path))) { rule = undefined; skip = true; continue; }
      rule = { path, headers: {}, unset: [] };
      continue;
    }
    if (skip || !rule) continue;
    if (!line.includes(':')) { if (line.startsWith('! ')) rule.unset.push(line.replace('! ', '')); continue; }
    const [rawName, ...rawValue] = line.split(':');
    const name = (rawName ?? '').trim().toLowerCase();
    const value = rawValue.join(':').trim();
    if (!name || name.includes(' ') || !value) continue;
    rule.headers[name] = rule.headers[name] ? `${rule.headers[name]}, ${value}` : value;
  }
  push();
  if (!rules.length) return undefined;
  const out: Headers_ = { version: 2, rules: {} };
  for (const r of rules) out.rules[r.path] = { ...(Object.keys(r.headers).length ? { set: r.headers } : {}), ...(r.unset.length ? { unset: r.unset } : {}) };
  return out;
}

// ── the rules engine ───────────────────────────────────────────────────────────────────────────
const escapeRegex = (s: string): string => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const replacer = (s: string, replacements: Record<string, string>): string => {
  for (const [k, v] of Object.entries(replacements)) s = s.replaceAll(`:${k}`, v);
  return s;
};
function ruleRegExp(rule: string): RegExp {
  rule = rule.split('*').map(escapeRegex).join('(?<splat>.*)');
  for (const m of rule.matchAll(/(?<=^https:\\\/\\\/[^/]*?):([A-Za-z]\w*)(?=\\)/g)) rule = rule.split(m[0]).join(`(?<${m[1]}>[^/.]+)`);
  for (const m of rule.matchAll(/:([A-Za-z]\w*)/g)) rule = rule.split(m[0]).join(`(?<${m[1]}>[^/]+)`);
  return RegExp(`^${rule}$`);
}
function matchRules<T>(rules: Record<string, T> | undefined, url: URL, replace: (match: T, groups: Record<string, string>) => T): T[] {
  const out: T[] = [];
  for (const [rule, match] of Object.entries(rules ?? {})) {
    let re: RegExp;
    try { re = ruleRegExp(rule); } catch { continue; }
    const found = re.exec(rule.startsWith('https://') ? `https://${url.hostname}${url.pathname}` : url.pathname);
    if (found) out.push(replace(match, found.groups ?? {}));
  }
  return out;
}

// ── serving ────────────────────────────────────────────────────────────────────────────────────
type Exists = (path: string) => string | null;
type Intent = { eTag: string; status: 200 | 404; redirect: null } | { eTag: null; status: null; redirect: string } | null;
const asset = (eTag: string | null, status: 200 | 404 = 200): Intent => (eTag ? { eTag, status, redirect: null } : null);

function getIntent(path: string, config: AssetsConfig, exists: Exists, skip = false): Intent {
  const mode = config.html_handling ?? 'auto-trailing-slash';
  const redirect = (file: string, destination: string): Intent => {
    if (skip || exists(destination)) return null;
    const there = getIntent(destination, config, exists, true);
    return there && there.eTag && there.eTag === exists(file) ? { eTag: null, status: null, redirect: destination } : null;
  };
  const exact = exists(path);
  let r: Intent;
  if (mode === 'none') return asset(exact) ?? notFound(path, config, exists);
  if (mode === 'auto-trailing-slash') {
    if (path.endsWith('/index')) {
      if (exact) return asset(exact);
      if ((r = redirect(`${path}.html`, path.slice(0, -'index'.length))) || (r = redirect(`${path.slice(0, -'/index'.length)}.html`, path.slice(0, -'/index'.length)))) return r;
    } else if (path.endsWith('/index.html')) {
      if ((r = redirect(path, path.slice(0, -'index.html'.length))) || (r = redirect(`${path.slice(0, -'/index.html'.length)}.html`, path.slice(0, -'/index.html'.length)))) return r;
    } else if (path.endsWith('/')) {
      const index = exists(`${path}index.html`);
      if (index) return asset(index);
      if ((r = redirect(`${path.slice(0, -1)}.html`, path.slice(0, -1)))) return r;
    } else if (path.endsWith('.html')) {
      if ((r = redirect(path, path.slice(0, -'.html'.length))) || (r = redirect(`${path.slice(0, -'.html'.length)}/index.html`, `${path.slice(0, -'.html'.length)}/`))) return r;
    }
    if (exact) return asset(exact);
    const html = exists(`${path}.html`);
    if (html) return asset(html);
    if ((r = redirect(`${path}/index.html`, `${path}/`))) return r;
    return notFound(path, config, exists);
  }
  if (mode === 'force-trailing-slash') {
    if (path.endsWith('/index')) {
      if (exact) return asset(exact);
      if ((r = redirect(`${path}.html`, path.slice(0, -'index'.length))) || (r = redirect(`${path.slice(0, -'/index'.length)}.html`, path.slice(0, -'index'.length)))) return r;
    } else if (path.endsWith('/index.html')) {
      if ((r = redirect(path, path.slice(0, -'index.html'.length))) || (r = redirect(`${path.slice(0, -'/index.html'.length)}.html`, path.slice(0, -'index.html'.length)))) return r;
    } else if (path.endsWith('/')) {
      const found = exists(`${path}index.html`) ?? exists(`${path.slice(0, -1)}.html`);
      if (found) return asset(found);
    } else if (path.endsWith('.html')) {
      if ((r = redirect(path, `${path.slice(0, -'.html'.length)}/`))) return r;
      if (exact) return asset(exact);
      if ((r = redirect(`${path.slice(0, -'.html'.length)}/index.html`, `${path.slice(0, -'.html'.length)}/`))) return r;
    }
    if (exact) return asset(exact);
    if ((r = redirect(`${path}.html`, `${path}/`)) || (r = redirect(`${path}/index.html`, `${path}/`))) return r;
    return notFound(path, config, exists);
  }
  // drop-trailing-slash
  if (path.endsWith('/index')) {
    if (exact) return asset(exact);
    if (path === '/index') { if ((r = redirect('/index.html', '/'))) return r; }
    else if ((r = redirect(`${path.slice(0, -'/index'.length)}.html`, path.slice(0, -'/index'.length))) || (r = redirect(`${path}.html`, path.slice(0, -'/index'.length)))) return r;
  } else if (path.endsWith('/index.html')) {
    if (path === '/index.html') { if ((r = redirect('/index.html', '/'))) return r; }
    else if ((r = redirect(path, path.slice(0, -'/index.html'.length)))) return r;
    else if (exact) return asset(exact);
    else if ((r = redirect(`${path.slice(0, -'/index.html'.length)}.html`, path.slice(0, -'/index.html'.length)))) return r;
  } else if (path.endsWith('/')) {
    if (path === '/') { const index = exists('/index.html'); if (index) return asset(index); }
    else if ((r = redirect(`${path.slice(0, -1)}.html`, path.slice(0, -1))) || (r = redirect(`${path.slice(0, -1)}/index.html`, path.slice(0, -1)))) return r;
  } else if (path.endsWith('.html')) {
    if ((r = redirect(path, path.slice(0, -'.html'.length))) || (r = redirect(`${path.slice(0, -'.html'.length)}/index.html`, path.slice(0, -'.html'.length)))) return r;
  }
  return asset(exact) ?? asset(exists(`${path}.html`)) ?? asset(exists(`${path}/index.html`)) ?? notFound(path, config, exists);
}

// source: https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/ "Workers will serve the contents of the nearest 404.html file with a 404 Not Found status"
function notFound(path: string, config: AssetsConfig, exists: Exists): Intent {
  if (config.not_found_handling === 'single-page-application') return asset(exists('/index.html'));
  if (config.not_found_handling === '404-page') {
    for (let cwd = path; cwd;) {
      cwd = cwd.slice(0, cwd.lastIndexOf('/'));
      const page = exists(`${cwd}/404.html`);
      if (page) return asset(page, 404);
    }
  }
  return null;
}

const decodePath = (p: string): string => p.split('/').map((x) => { try { return decodeURIComponent(x); } catch { return x; } }).join('/').replace(/\/+/g, '/');
const encodePath = (p: string): string => p.split('/').map((x) => encodeURIComponent(x)).join('/');
const STATUS_TEXT: Record<number, string> = { 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect' };
const redirectTo = (status: number, location: string): Response => new Response(null, { status, statusText: STATUS_TEXT[status], headers: { Location: location } });

/** The answer to `request` from a Worker's assets: `manifest` maps each path to its hash, `read` gives a hash's bytes
 *  and the content type it was uploaded with. */
// source: https://developers.cloudflare.com/workers/static-assets/redirects/ "Redirects are always followed, regardless of whether or not an asset matches the incoming request."
export async function serveAssets(request: Request, manifest: Record<string, { hash: string }>, config: AssetsConfig,
  read: (hash: string) => Promise<{ bytes: Uint8Array; type?: string } | undefined>): Promise<Response> {
  const url = new URL(request.url);
  const exists: Exists = (p) => manifest[p]?.hash ?? null;
  let pathname = url.pathname;
  const fixed = config.redirects?.staticRules ?? {};
  const withHost = fixed[`https://${url.host}${pathname}`], without = fixed[pathname];
  const matched = (withHost && without ? (withHost.lineNumber < without.lineNumber ? withHost : without) : withHost ?? without)
    ?? matchRules(config.redirects?.version === 1 ? config.redirects.rules : {}, url, ({ status, to }, groups) => {
      const target = replacer(to, groups).trim();
      return { status, to: /^(\w+:\/\/)/.test(target) ? target : target.replace(/\/+/g, '/') };
    })[0];
  let response: Response;
  if (matched && matched.status !== 200) {
    const destination = new URL(matched.to, request.url);
    const location = destination.origin === url.origin
      ? `${destination.pathname}${destination.search || url.search}${destination.hash}`
      : `${destination.href.slice(0, destination.href.length - (destination.search.length + destination.hash.length))}${destination.search || url.search}${destination.hash}`;
    response = redirectTo(matched.status, location);
  } else {
    if (matched) pathname = new URL(matched.to, request.url).pathname;
    const decoded = decodePath(pathname);
    const intent = getIntent(decoded, config, exists);
    const method = request.method.toUpperCase();
    if (!intent) response = new Response(null, { status: 404, statusText: 'Not Found' });
    else if (!['GET', 'HEAD'].includes(method)) response = new Response(null, { status: 405, statusText: 'Method Not Allowed' });
    else {
      const destination = encodePath(intent.redirect ?? decoded);
      if ((destination !== pathname && intent.eTag) || intent.redirect) response = redirectTo(307, destination + url.search);
      else {
        const eTag = intent.eTag!;
        const held = await read(eTag);
        if (!held) response = new Response(null, { status: 404, statusText: 'Not Found' });
        else {
          const headers = new Headers({ ETag: `"${eTag}"` });
          if (held.type && held.type !== 'application/null') headers.append('Content-Type', held.type);
          if (!request.headers.has('Authorization') && !request.headers.has('Range')) headers.append('Cache-Control', CACHE_CONTROL_BROWSER);
          headers.append('CF-Cache-Status', 'HIT');
          const ifNoneMatch = request.headers.get('If-None-Match') ?? '';
          if ([`"${eTag}"`, `W/"${eTag}"`].includes(ifNoneMatch)) response = new Response(null, { status: 304, statusText: 'Not Modified', headers });
          else response = new Response(method === 'HEAD' ? null : held.bytes as Uint8Array<ArrayBuffer>, { status: intent.status!, headers });
        }
      }
    }
  }
  // the custom headers (`_headers`), after the redirects: "Redirects execute before headers"
  const set = new Set<string>();
  const headers = new Headers(response.headers);
  for (const { set: add = {}, unset = [] } of matchRules(config.headers?.version === 2 ? config.headers.rules : {}, url, ({ set: s = {}, unset: u = [] }, groups) => ({ set: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, replacer(v, groups)])), unset: u }))) {
    for (const k of unset) headers.delete(k);
    for (const [k, v] of Object.entries(add)) { if (set.has(k.toLowerCase())) headers.append(k, v); else { headers.set(k, v); set.add(k.toLowerCase()); } }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The configuration an upload's `assets.config` gives: its handling modes, and its `_redirects` and `_headers` text
 *  parsed as the API parses them. */
// source: https://developers.cloudflare.com/workers/static-assets/redirects/ "This file will not itself be served as a static asset, but will instead be parsed by Workers"
export function assetsConfigOf(raw: Row | null | undefined): AssetsConfig {
  const c = raw ?? {};
  const html = typeof c.html_handling === 'string' ? c.html_handling : undefined;
  return {
    ...(html ? { html_handling: html } : {}),
    ...(typeof c.not_found_handling === 'string' ? { not_found_handling: c.not_found_handling } : {}),
    ...(typeof c._redirects === 'string' && parseRedirects(c._redirects, html) ? { redirects: parseRedirects(c._redirects, html) } : {}),
    ...(typeof c._headers === 'string' && parseHeaders(c._headers) ? { headers: parseHeaders(c._headers) } : {}),
  };
}

// source: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ "All Workers are assigned a workers.dev route when they are created or renamed"
export function workerHosts(ctx: HandlerContext): string[] {
  return ctx.rowsRaw('worker_script').filter((script) => script.deleted !== true && (script.subdomain as { enabled?: boolean } | undefined)?.enabled === true).flatMap((script) => {
    const subdomain = ctx.rowsRaw('workers_subdomain').find((row) => row.deleted !== true && sameAccount(ctx, row.id, script.account_id));
    const name = String(script.id).slice(String(script.id).lastIndexOf('/') + 1);
    return subdomain ? [`${name}.${String(subdomain.subdomain)}.workers.dev`] : [];
  });
}

export const WORKER_DOMAIN = 'worker_domain';

/** A request to a Workers Custom Domain, answered by its Worker's static assets, or undefined when no Worker holds the
 *  hostname. A Worker with its own script runs it for what no asset answers; the World's Workers run no code, so that
 *  request is the gap's answer. */
// source: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ "Cloudflare will first attempt to serve static assets if one matches the incoming request"
export async function workerDomainAnswer(ctx: HandlerContext, host: string, request: Request): Promise<Response | undefined> {
  const domain = ctx.rowsRaw(WORKER_DOMAIN).find((d) => d.hostname === host && d.deleted !== true);
  const subdomain = !domain && host.endsWith('.workers.dev') ? ctx.rowsRaw('workers_subdomain').find((row) => row.deleted !== true && host.endsWith(`.${String(row.subdomain)}.workers.dev`)) : undefined;
  if (!domain && !subdomain) return undefined;
  const account = String(domain?.account_id ?? subdomain!.id);
  const name = domain ? String(domain.service) : host.slice(0, -(`.${String(subdomain!.subdomain)}.workers.dev`).length);
  // the Worker by its name under either of the account's ids (one uploaded before a deploy adopted the account keeps the World's)
  const script = ctx.rowsRaw('worker_script').find((s) => s.deleted !== true && String(s.id).endsWith(`/${name}`) && sameAccount(ctx, s.account_id, account));
  if (!domain && (!script || (script.subdomain as { enabled?: boolean } | undefined)?.enabled !== true)) return undefined;
  const assets = script && script.deleted !== true ? script.assets as { manifest?: Record<string, { hash: string }>; config?: AssetsConfig } | null : null;
  const code = !!script?.main_module;
  const gap = (): Response => apiError(501, 10000, 'The World runs no Worker code: this request would reach the Worker script.');
  if (!assets?.manifest) return code ? gap() : new Response(null, { status: 404, statusText: 'Not Found' });
  // an asset is kept under the account's id as it was when uploaded: the World's before a deploy adopted the account, the
  // real one after; the domain, the Worker's key and either resolved name them
  const owners = [...new Set([account, String(script!.id).slice(0, -(name.length + 1))].flatMap((a) => [a, ctx.resolve('account', a)]))];
  const read = async (hash: string): Promise<{ bytes: Uint8Array; type?: string } | undefined> => {
    for (const owner of owners) {
      const bytes = await ctx.blobs.get(`asset/${owner}/${hash}`);
      if (!bytes) continue;
      const type = await ctx.blobs.get(`asset-type/${owner}/${hash}`);
      return { bytes, type: type ? new TextDecoder().decode(type) : undefined }; }
    return undefined;
  };
  const config = code ? { ...assets.config, not_found_handling: 'none' } : assets.config ?? {};
  const answer = await serveAssets(request, assets.manifest, config, read);
  return code && answer.status === 404 ? gap() : answer;
}
