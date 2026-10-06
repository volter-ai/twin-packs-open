// Workers scripts (Cloudflare's "Worker Script" API), as wrangler deploy and wrangler secret put send them: the Worker's
// service read, a multipart module upload with its metadata (its assets uploaded beforehand through a session), the
// script's workers.dev route, its settings read back, and its secrets.
import type { HandlerContext } from '@volter/world-core';
import { sameAccount,
  accountOf, ASSET_SESSION, assetsJwt, assetsOfUpload, storedAssets, bindingsWith, requiredUploadBindings, callerEmail, DEPLOYMENT, fail, jwtSession, NAMESPACE, nextNumber, noAccount, noScript, ok, putSecret, type Row, SCRIPT,
  scriptKey, scriptNamed, scriptNameOf, scriptOf, scriptView, secretsOf, settingsView, VERSION,
} from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : {});
const decoder = new TextDecoder();
/** A bucket's byte budget: its files arrive as one request of their base64, which the kernel holds several times over
 *  before the handler reads its parts, and wrangler uploads three buckets at once (its BULK_UPLOAD_CONCURRENCY), all
 *  inside the 128 MB of a hosted World's one isolate. Measured 2026-10-03 on the hosted Worker volter-worlds with
 *  wrangler 4.147.0 deploying `volter-ai/sites` videogame-ai/dist (98 files, 57 MB): 50-file buckets (6e9da19's parent)
 *  and 8 MiB buckets (6e9da19) each answered 500 "exceeded its memory limit"; 2 MiB buckets (f106636) deployed.
 *  Where the measurement stops: that site's largest file is 2.7 MiB, so a file larger than that, alone in its bucket,
 *  has no reading (by the kernel's copies of a body, about six times its base64 is held, which a 25 MiB file would put
 *  past 128 MB); and ffae795's decode, which holds no string of the file, was read on Node and Bun, not on a host. */
const BUCKET_BYTES = 2 * 1024 * 1024;

const BASE64 = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) BASE64['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i;
/** Standard base64, read straight from the part's bytes into the file's: one output buffer, no string of the whole file
 *  and no list of its characters. Whitespace is skipped; any other character, or a broken length, is null. */
function fromBase64(input: Uint8Array): Uint8Array | null {
  let n = 0;
  for (const c of input) if (c !== 0x3d && c !== 0x0a && c !== 0x0d && c !== 0x20 && c !== 0x09) n++;
  if (n % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let acc = 0; let bits = 0; let at = 0; let ended = false;
  for (const c of input) {
    if (c === 0x0a || c === 0x0d || c === 0x20 || c === 0x09) continue;
    if (c === 0x3d) { ended = true; continue; }
    const v = c < 128 ? BASE64[c]! : -1;
    if (v < 0 || ended) return null;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[at++] = (acc >> bits) & 0xff; }
  }
  return out;
}

/** The script's modules and metadata from a multipart upload: the `metadata` part (JSON) and each module part. */
// source: https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/ "main_module"
async function uploaded(ctx: HandlerContext): Promise<{ metadata: Row; modules: Array<{ name: string; type: string; bytes: Uint8Array }> } | Response> {
  const parts = await ctx.parts();
  const meta = parts.find((p) => p.name === 'metadata');
  if (!meta) return fail(400, 10021, 'Uncaught Error: No metadata part was uploaded.');
  let metadata: Row;
  try { metadata = JSON.parse(decoder.decode(meta.body)) as Row; } catch { return fail(400, 10021, 'The metadata part is not JSON.'); }
  // source: https://developers.cloudflare.com/workers/observability/errors/ "Validation Error. Refer to Validation Errors for details."
  // Where the documentation stops: the validation code is documented, the missing-part wording is not.
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fail(400, 10021, 'The metadata part must be an object.');
  const invalidBindings = requiredUploadBindings(metadata);
  if (invalidBindings) return invalidBindings;
  const modules = parts.filter((p) => p.name !== 'metadata').map((p) => ({ name: p.filename ?? p.name, type: p.type ?? 'application/javascript+module', bytes: p.body }));
  // source: archive:https://registry.npmjs.org/wrangler/-/wrangler-4.137.0.tgz#sha256=f39ad65a122b15acf74c38f9575dce6147810e308995909050e9e29668685ca1!/package/wrangler-dist/cli.js "if (assets && !assets.routerConfig.has_user_worker)"
  const assetsOnly = metadata.main_module === undefined && metadata.body_part === undefined && typeof (metadata.assets as Row | undefined)?.jwt === 'string';
  // source: spec:/components/schemas/workers_multipart-script/properties/files "At least one module must be present and referenced in the metadata"
  const entry = metadata.main_module ?? metadata.body_part;
  if (!assetsOnly && (typeof entry !== 'string' || entry.length === 0)) return fail(400, 10021, 'main_module or body_part is required for a Worker with code.');
  if (!assetsOnly && !modules.some((m) => m.name === entry)) return fail(400, 10021, `No such module "${entry}".`);
  return { metadata, modules };
}

/** A script's durable object namespaces after its migrations: each new class one namespace, a deleted one gone. */
// source: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/ "new_sqlite_classes"
async function migrate(ctx: HandlerContext, account: string, name: string, prior: Row | undefined, metadata: Row): Promise<string | Response> {
  const m = (metadata.migrations as Row | undefined) ?? undefined;
  if (!m) return String(prior?.migration_tag ?? '');
  const steps = Array.isArray(m.steps) ? m.steps as Row[] : [m];
  const held = String(prior?.migration_tag ?? '');
  // Where the documentation stops: the refusal's code for a migration whose old tag is not the script's is not recorded
  if (m.old_tag !== undefined && String(m.old_tag) !== held) return fail(400, 10079, `Migration old_tag ${String(m.old_tag)} is not the script's current tag ${held || '(none)'}.`);
  // a script's namespace for a class, found by what it is (its id is minted when the migration makes it)
  const held_ = (cls: string): Row | undefined => ctx.rowsRaw(NAMESPACE).find((n) => sameAccount(ctx, n.account_id, account) && n.script === name && n.class === cls && n.deleted !== true);
  for (const step of steps) {
    for (const cls of [...((step.new_classes as string[] | undefined) ?? []), ...((step.new_sqlite_classes as string[] | undefined) ?? [])]) {
      if (held_(cls)) continue;
      const id = ctx.mint(NAMESPACE);
      await ctx.write(NAMESPACE, id, { id, account_id: account, name: `${name}_${cls}`, script: name, class: cls, use_sqlite: ((step.new_sqlite_classes as string[] | undefined) ?? []).includes(cls) }, 'durable_object_namespace.create');
    }
    for (const cls of (step.deleted_classes as string[] | undefined) ?? []) {
      const gone = held_(cls);
      if (gone) await ctx.remove(NAMESPACE, String(gone.id), 'durable_object_namespace.delete');
    }
    for (const r of (step.renamed_classes as Row[] | undefined) ?? []) {
      const from = held_(String(r.from));
      if (from) await ctx.write(NAMESPACE, String(from.id), { class: r.to, name: `${name}_${String(r.to)}` }, 'durable_object_namespace.update');
    }
  }
  return String(m.new_tag ?? m.tag ?? held);
}

/** A script's secrets after an upload: those its metadata binds as `secret_text` are put, and every other secret the
 *  script has stays. Where the documentation stops: the page says so of an upload that carries secrets; an upload that
 *  carries none, as wrangler deploy sends one, keeps them too, since wrangler checks a Worker's configured secrets before
 *  it deploys. */
// source: https://developers.cloudflare.com/workers/configuration/secrets/ "Secrets not included in the file are preserved from the previous version."
// source: https://developers.cloudflare.com/workers/configuration/secrets/ "will fail with a clear error if any required secrets are not configured on the Worker"
async function secretsAfter(ctx: HandlerContext, key: string, metadata: Row): Promise<void> {
  for (const b of ((metadata.bindings as Row[] | undefined) ?? []).filter((x) => x.type === 'secret_text' && typeof x.name === 'string')) await putSecret(ctx, key, String(b.name), String(b.text ?? ''));
}

/** `GET …/workers/services/{name}`: the Worker as a service, its one environment (`production`) and that environment's
 *  script; a Worker not deployed is the script-not-found wrangler suppresses before its first upload. */
// source: https://unpkg.com/wrangler@4.143.0/wrangler-dist/cli.js "script = serviceMetadata.default_environment.script;"
export async function worker_service_get(ctx: HandlerContext): Promise<Response> {
  const s = scriptNamed(ctx, String(ctx.call.params.account_id), String(ctx.call.params.service_name));
  if (!s) return noScript();
  return ok({ id: scriptNameOf(s), default_environment: { environment: 'production', script: scriptView(s) }, created_on: s.created_on, modified_on: s.modified_on });
}

/** `GET /accounts/{account}/workers/scripts`: the account's Workers, each as its upload answered it, as a vendor-backed
 *  World's refresh reads them back. */
// source: spec:worker-script-list-workers "Fetch a list of uploaded Worker scripts."
export async function worker_script_list_workers(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  return ok(ctx.rowsRaw(SCRIPT).filter((s) => sameAccount(ctx, s.account_id, account.id) && s.deleted !== true).map(scriptView));
}

/** `PUT /accounts/{account}/workers/scripts/{name}`: the script uploaded (created or replaced), a version made of it and
 *  deployed at 100%, as an upload that is not a version upload is deployed at once. */
// source: spec:worker-script-upload-worker-module "Upload a worker module."
export async function worker_script_upload_worker_module(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const name = String(ctx.call.params.script_name);
  const up = await uploaded(ctx);
  if (up instanceof Response) return up;
  // the script's own key when it has one under either of the account's ids, else one under the account's id now
  const key = String(scriptNamed(ctx, String(account.id), name)?.id ?? scriptKey(String(account.id), name));
  const prior = ctx.row(SCRIPT, key);
  const live = prior && prior.deleted !== true ? prior : undefined;
  // the assets: a completion token names a finished session of this account; `keep_assets` keeps the script's. Read
  // before the migrations write, so an upload refused for its token makes no namespace
  // source: https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/ "Specifies whether assets should be retained from a previously uploaded Worker version"
  const assets = await assetsOfUpload(ctx, up.metadata, live, String(account.id));
  if (assets instanceof Response) return assets;
  const tag = await migrate(ctx, String(account.id), name, live, up.metadata);
  if (typeof tag !== 'string') return tag;
  for (const m of up.modules) await ctx.blobs.put(`worker/${String(account.id)}/${name}/${m.name}`, m.bytes);
  // source: https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/ "2021-11-02"
  const at = ctx.occurredAt;
  const etag = ctx.crypto.digest('sha256', up.modules.map((m) => `${m.name}:${ctx.crypto.digest('sha256', m.bytes, 'hex')}`).join('|'), 'hex');
  await ctx.write(SCRIPT, key, {
    name, account_id: account.id, tag: live?.tag ?? ctx.mint(SCRIPT), etag, created_on: live?.created_on ?? at, modified_on: at,
    main_module: up.metadata.main_module ?? up.modules[0]?.name ?? null, modules: up.modules.map((m) => ({ name: m.name, type: m.type, size: m.bytes.byteLength })),
    compatibility_date: up.metadata.compatibility_date ?? '2021-11-02', compatibility_flags: up.metadata.compatibility_flags ?? [], bindings: ((up.metadata.bindings as Row[] | undefined) ?? []).filter((b) => b.type !== 'secret_text'),
    migration_tag: tag || null, assets: storedAssets(assets), ...(typeof assets?._blobAccount === 'string' ? { _assetAccount: assets._blobAccount } : {}), placement: up.metadata.placement ?? {}, observability: up.metadata.observability ?? null, handlers: ['fetch'], limits: up.metadata.limits ?? {},
    // what an upload does not version stays the script's (its tags, set apart through its script settings), unless sent
    tags: up.metadata.tags ?? live?.tags ?? [], logpush: up.metadata.logpush === undefined ? live?.logpush === true : up.metadata.logpush === true,
    tail_consumers: up.metadata.tail_consumers ?? live?.tail_consumers ?? null,
  }, live ? 'worker_script.update' : 'worker_script.create');
  await secretsAfter(ctx, key, up.metadata);
  const author = callerEmail(ctx);
  const version = ctx.mint('workers_version-item-full');
  await ctx.write(VERSION, version, { id: version, script: key, number: nextNumber(ctx, key), created_on: at, metadata: { source: 'wrangler', author_email: author, created_on: at, modified_on: at }, main_module: up.metadata.main_module ?? null, bindings: bindingsWith(ctx, key, (up.metadata.bindings as Row[] | undefined) ?? []), compatibility_date: up.metadata.compatibility_date ?? '2021-11-02', compatibility_flags: up.metadata.compatibility_flags ?? [], assets: storedAssets(assets), ...(typeof assets?._blobAccount === 'string' ? { _assetAccount: assets._blobAccount } : {}) }, 'worker_version.create');
  const deployment = ctx.mint('workers_deployment');
  await ctx.write(DEPLOYMENT, deployment, { id: deployment, script: key, created_on: at, source: 'api', strategy: 'percentage', versions: [{ version_id: version, percentage: 100 }], annotations: {}, author_email: author }, 'worker_deployment.create');
  return ok({ ...scriptView(ctx.row(SCRIPT, key)!), deployment_id: deployment });
}

/** `POST …/scripts/{name}/assets-upload-session`: a session over the manifest: the upload JWT, and the hashes still to
 *  upload in buckets (none of those an earlier session uploaded). With nothing to upload, the JWT is the completion
 *  token. */
// source: https://developers.cloudflare.com/workers/static-assets/direct-upload/ "will contain a completion token"
export async function worker_script_update_create_assets_upload_session(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const manifest = (bodyOf(ctx).manifest as Record<string, Row> | undefined) ?? undefined;
  if (!manifest || typeof manifest !== 'object') return fail(400, 10021, 'manifest is required');
  // source: spec:/components/schemas/workers_manifest-value/properties/hash "The hash of the file."
  // source: spec:/components/schemas/workers_manifest-value/properties/size "The size of the file in bytes."
  if (Array.isArray(manifest) || Object.values(manifest).some((f) => !f || typeof f.hash !== 'string' || typeof f.size !== 'number')) return fail(400, 10021, 'Each manifest entry requires hash and size.');
  const hashes = [...new Set(Object.values(manifest).map((f) => String(f.hash)))];
  const missing: string[] = [];
  for (const h of hashes) if (!(await ctx.blobs.get(`asset/${String(account.id)}/${h}`))) missing.push(h);
  const session = ctx.mint(ASSET_SESSION);
  await ctx.record(ASSET_SESSION, { account_id: account.id, manifest, missing, created_on: ctx.occurredAt }, session);
  // the twin batches the missing files into buckets of at most 50 files and BUCKET_BYTES of their manifest sizes (the
  // direct-upload page leaves the batching to Cloudflare): a bucket is one request, held whole while its base64 is
  // decoded, so its bytes, not its count, bound what one upload costs a hosted World's isolate. A file over the budget
  // is a bucket of its own.
  const sizes = new Map<string, number>();
  // a size that is not a whole number of bytes counts as the whole budget: the file goes in a bucket of its own
  for (const f of Object.values(manifest)) { const size = Number(f.size); sizes.set(String(f.hash), Number.isSafeInteger(size) && size >= 0 ? size : BUCKET_BYTES); }
  const buckets: string[][] = [];
  let bucket: string[] = [];
  let bytes = 0;
  for (const h of missing) {
    const size = sizes.get(h) ?? 0;
    if (bucket.length > 0 && (bucket.length === 50 || bytes + size > BUCKET_BYTES)) { buckets.push(bucket); bucket = []; bytes = 0; }
    bucket.push(h);
    bytes += size;
  }
  if (bucket.length > 0) buckets.push(bucket);
  return ok({ jwt: await assetsJwt(ctx, session, missing.length === 0), buckets });
}

/** `POST /accounts/{account}/workers/assets/upload?base64=true`: files by their hash, base64 in multipart parts,
 *  authenticated by the session's upload JWT; once every file is in, 201 and the completion token. */
// source: https://developers.cloudflare.com/workers/static-assets/direct-upload/ "Once every file in the manifest has been uploaded, a status code of 201 will be returned"
export async function worker_assets_upload(ctx: HandlerContext): Promise<Response> {
  const token = /^Bearer\s+(.+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1] ?? '';
  const j = await jwtSession(ctx, token);
  const session = j ? ctx.row(ASSET_SESSION, j.session) : undefined;
  if (!j || !session) return fail(401, 10001, 'The upload token is not valid.');
  for (const part of await ctx.parts()) {
    const bytes = fromBase64(part.body);
    if (!bytes) return fail(400, 10021, `The file ${part.name} is not base64.`);
    await ctx.blobs.put(`asset/${String(session.account_id)}/${part.name}`, bytes);
    // the type the file is served with: its part's, "application/null" meaning none
    // source: https://unpkg.com/wrangler@4.143.0/wrangler-dist/cli.js "to mean actually null (signal to not send a Content-Type header with the response)"
    await ctx.blobs.put(`asset-type/${String(session.account_id)}/${part.name}`, new TextEncoder().encode(part.type ?? 'application/null'));
  }
  const left: string[] = [];
  for (const h of (session.missing as string[] | undefined) ?? []) if (!(await ctx.blobs.get(`asset/${String(session.account_id)}/${h}`))) left.push(h);
  if (left.length > 0) return ok({ jwt: null });
  return ok({ jwt: await assetsJwt(ctx, j.session, true) }, 201);
}

/** `POST …/scripts/{name}/subdomain`: the script on the account's workers.dev subdomain, and its previews, or not. */
// source: spec:worker-script-post-subdomain "Update Worker Script Subdomain"
export async function worker_script_post_subdomain(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const body = bodyOf(ctx);
  const enabled = body.enabled === true;
  const previews = body.previews_enabled === undefined ? enabled : body.previews_enabled === true;
  await ctx.write(SCRIPT, String(s.id), { subdomain: { enabled, previews_enabled: previews } }, 'worker_script.update');
  return ok({ enabled, previews_enabled: previews });
}

// source: spec:worker-script-get-subdomain "Get Worker Script Subdomain"
export async function worker_script_get_subdomain(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  return ok((s.subdomain as Row | undefined) ?? { enabled: false, previews_enabled: false });
}

// source: spec:worker-script-get-settings "Get Worker Script and Version Settings"
export async function worker_script_get_settings(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  return s ? ok(settingsView(ctx, s)) : noScript();
}

/** The script-level settings (`…/script-settings`): what a version does not carry, which wrangler patches after a
 *  deploy (its service and environment tags, its observability, its tail consumers and logpush). */
const scriptSettings = (s: Row): Row => ({ logpush: s.logpush === true, observability: s.observability ?? null, tags: s.tags ?? [], tail_consumers: (s.tail_consumers as Row[] | undefined) ?? null });

// source: spec:worker-script-settings-get-settings "Get Worker Script Settings"
export async function worker_script_settings_get_settings(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  return s ? ok(scriptSettings(s)) : noScript();
}

/** `PATCH …/script-settings`: only the fields sent change; a list sent replaces the one held. */
// source: spec:worker-script-settings-patch-settings "Patch Worker Script Settings"
export async function worker_script_settings_patch_settings(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const body = bodyOf(ctx);
  const patch: Row = {};
  if (body.tags !== undefined) {
    if (body.tags !== null && (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string'))) return fail(400, 10021, 'tags must be a list of strings');
    patch.tags = body.tags ?? [];
  }
  if (body.logpush !== undefined) {
    if (typeof body.logpush !== 'boolean') return fail(400, 10021, 'logpush must be a boolean');
    patch.logpush = body.logpush;
  }
  if (body.observability !== undefined) {
    if (body.observability !== null && (typeof body.observability !== 'object' || Array.isArray(body.observability))) return fail(400, 10021, 'observability must be an object');
    patch.observability = body.observability;
  }
  if (body.tail_consumers !== undefined) {
    // source: spec:/components/schemas/workers_tail_consumers_script "service"
    if (body.tail_consumers !== null && (!Array.isArray(body.tail_consumers) || body.tail_consumers.some((t) => !t || typeof t !== 'object' || typeof (t as Row).service !== 'string'))) return fail(400, 10021, 'tail_consumers: a list of { service }');
    patch.tail_consumers = body.tail_consumers;
  }
  if (Object.keys(patch).length) await ctx.write(SCRIPT, String(s.id), patch, 'worker_script.update');
  return ok(scriptSettings({ ...s, ...patch }));
}

/** `GET …/secrets`: the names of the secrets bound to the script, never their text. */
// source: spec:worker-list-script-secrets "List the names of secrets bound to a Worker script."
export async function worker_list_script_secrets(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  return s ? ok(secretsOf(ctx, String(s.id)).map((x) => ({ name: x.name, type: 'secret_text' }))) : noScript();
}

/** `PUT …/secrets` `{ name, text, type: secret_text }`: a secret bound to the script (replacing one of its name). */
// source: spec:worker-put-script-secret "Add a secret to a Worker script"
export async function worker_put_script_secret(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const body = bodyOf(ctx);
  if (typeof body.name !== 'string' || typeof body.text !== 'string') return fail(400, 10021, 'name and text are required');
  await putSecret(ctx, String(s.id), body.name, body.text);
  return ok({ name: body.name, type: 'secret_text' });
}
