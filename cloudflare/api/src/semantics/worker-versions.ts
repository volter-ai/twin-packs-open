// A script's versions: uploaded without being deployed (wrangler deploy's path for a Worker it has deployed before), and
// read back (each upload of the script made one).
import type { HandlerContext } from '@volter/world-core';
import { assetsOfUpload, storedAssets, bindingsWith, requiredUploadBindings, bindingView, callerEmail, fail, nextNumber, noScript, ok, type Row, scriptOf, VERSION } from './shared.ts';

/** A version as the vendor answers it: one an upload made, from what it kept; one a vendor-backed refresh read whole by
 *  its detail, as read. */
const view = (v: Row): Row => ({
  id: v.id, number: v.number, metadata: v.metadata ?? {},
  resources: (v.resources as Row | undefined) ?? { script: { etag: v.etag ?? null, handlers: ['fetch'], last_deployed_from: 'api' }, script_runtime: { compatibility_date: v.compatibility_date ?? null, compatibility_flags: v.compatibility_flags ?? [], usage_model: 'standard' }, bindings: ((v.bindings as Row[] | undefined) ?? []).map(bindingView) },
});

// source: spec:worker-versions-list-versions "List of Worker Versions. The first version in the list is the latest version."
export async function worker_versions_list_versions(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const key = String(s.id);
  return ok({ items: ctx.rowsRaw(VERSION).filter((v) => v.script === key).sort((a, b) => Number(b.number) - Number(a.number)).map((row) => view(ctx.own(row))) });
}


/** `GET …/versions/{version_id}`: one of the script's versions, whole (a vendor-backed World's refresh reads each listed
 *  version so). */
// source: spec:worker-versions-get-version-detail "Retrieves detailed information about a specific version of a Worker script."
// Where the documentation stops: a version the script does not have is answered as an unknown script's is (10007)
export async function worker_versions_get_version_detail(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  const v = s ? ctx.rowsRaw(VERSION).find((row) => row.script === String(s.id) && row.id === ctx.call.params.version_id) : undefined;
  return v ? ok(view(ctx.own(v))) : noScript();
}

/** `POST …/versions` (multipart, as a script upload): a version, not deployed, with its static assets, served once a
 *  deployment sends it the traffic. */
// source: spec:worker-versions-upload-version "Upload a Worker Version without deploying to Cloudflare's network."
export async function worker_versions_upload_version(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const key = String(s.id);
  const parts = await ctx.parts();
  const meta = parts.find((p) => p.name === 'metadata');
  // source: https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/ "multipart/form-data uploads require you to specify a metadata part."
  if (!meta) return fail(400, 10021, 'Uncaught Error: No metadata part was uploaded.');
  let metadata: Row = {};
  try { metadata = meta ? JSON.parse(new TextDecoder().decode(meta.body)) as Row : {}; } catch { return fail(400, 10021, 'The metadata part is not JSON.'); }
  // source: https://developers.cloudflare.com/workers/observability/errors/ "Validation Error. Refer to Validation Errors for details."
  // Where the documentation stops: the validation code is documented, the missing-part wording is not.
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fail(400, 10021, 'The metadata part must be an object.');
  const invalidBindings = requiredUploadBindings(metadata);
  if (invalidBindings) return invalidBindings;
  // source: archive:https://registry.npmjs.org/wrangler/-/wrangler-4.137.0.tgz#sha256=f39ad65a122b15acf74c38f9575dce6147810e308995909050e9e29668685ca1!/package/wrangler-dist/cli.js "if (assets && !assets.routerConfig.has_user_worker)"
  // Wrangler sends metadata alone for assets-only Workers. The sourced spec patch records that exception.
  const assetsOnly = metadata.main_module === undefined && metadata.body_part === undefined && typeof (metadata.assets as Row | undefined)?.jwt === 'string';
  // source: spec:/components/requestBodies/workers_version-post/content/multipart~1form-data/schema/properties/metadata/properties/main_module "Name of the uploaded file that contains the main module"
  if (!assetsOnly && (typeof metadata.main_module !== 'string' || metadata.main_module.length === 0)) return fail(400, 10021, 'main_module is required for a Worker with code.');
  // source: spec:/components/requestBodies/workers_version-post/content/multipart~1form-data/schema/properties/files "At least one module must be present and referenced in the metadata"
  if (!assetsOnly && !parts.some((p) => p.name !== 'metadata' && (p.filename ?? p.name) === metadata.main_module)) return fail(400, 10021, `No such module "${metadata.main_module}".`);
  const assets = await assetsOfUpload(ctx, metadata, s, String(s.account_id));
  if (assets instanceof Response) return assets;
  for (const p of parts.filter((x) => x.name !== 'metadata')) await ctx.blobs.put(`version/${key}/${p.filename ?? p.name}`, p.body);
  const id = ctx.mint('workers_version-item-full');
  await ctx.write(VERSION, id, { id, script: key, number: nextNumber(ctx, key), created_on: ctx.occurredAt, metadata: { source: 'wrangler', author_email: callerEmail(ctx), created_on: ctx.occurredAt, modified_on: ctx.occurredAt }, annotations: metadata.annotations ?? {}, main_module: metadata.main_module ?? null, bindings: bindingsWith(ctx, key, (metadata.bindings as Row[] | undefined) ?? []), compatibility_date: metadata.compatibility_date ?? null, compatibility_flags: metadata.compatibility_flags ?? [], assets: storedAssets(assets), ...(typeof assets?._blobAccount === 'string' ? { _assetAccount: assets._blobAccount } : {}) }, 'worker_version.create');
  return ok(view(ctx.own(ctx.row(VERSION, id)!)));
}
