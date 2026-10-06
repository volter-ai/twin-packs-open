// A script's deployments: which versions serve, and at what share (wrangler deploy reads the latest first).
import type { HandlerContext } from '@volter/world-core';
import { callerEmail, DEPLOYMENT, fail, noScript, ok, type Row, SCRIPT, scriptOf, VERSION } from './shared.ts';

// source: spec:worker-deployments-list-deployments "List Worker Deployments"
export async function worker_deployments_list_deployments(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const key = String(s.id);
  // each deployment as the vendor answers it (the kernel's view), without the script key the World files it under
  const deployments = ctx.rows('workers_deployment').filter((d) => d.script === key && d.deleted !== true).sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)));
  return ok({ deployments: deployments.map(({ script: _s, deleted: _d, ...d }) => d) });
}

/** `POST …/deployments` `{ strategy: percentage, versions: [{ version_id, percentage }] }`: the shares add to 100, each
 *  version the script's; the script then serves the static assets of the version taking the traffic (the World serves
 *  one version: the one with the largest share, where Cloudflare splits requests between them). */
// source: spec:worker-deployments-create-deployment "Deployments configure how [Worker Versions](https://developers.cloudflare.com/api/operations/worker-versions-list-versions) are deployed to traffic."
export async function worker_deployments_create_deployment(ctx: HandlerContext): Promise<Response> {
  const s = scriptOf(ctx);
  if (!s) return noScript();
  const key = String(s.id);
  const body = (ctx.body ?? {}) as Row;
  // source: spec:/components/schemas/workers_deployment/properties/strategy "percentage"
  // Where the documentation stops: this validation refusal's wording and code are not recorded.
  if (body.strategy !== 'percentage') return fail(400, 10221, 'strategy must be percentage.');
  const versions = Array.isArray(body.versions) ? body.versions as Row[] : [];
  // source: spec:/components/schemas/workers_deployment/properties/versions "Each object must contain"
  if (versions.some((v) => !v || typeof v.version_id !== 'string' || typeof v.percentage !== 'number')) return fail(400, 10221, 'Each version requires version_id and percentage.');
  // source: spec:/components/schemas/workers_deployment/properties/versions/items/properties/percentage "Percentage of traffic served by this version."
  // source: https://developers.cloudflare.com/workers/observability/errors/ "Validation Error. Refer to Validation Errors for details."
  // Where the documentation stops: a percentage-specific code and wording are not recorded; use the documented validation error.
  if (versions.some((v) => !Number.isFinite(v.percentage) || Number(v.percentage) < 0.01 || Number(v.percentage) > 100)) return fail(400, 10021, 'Version percentages must be between 0.01 and 100.');
  // Where the documentation stops: the codes of these two refusals are not recorded
  if (versions.reduce((n, v) => n + Number(v.percentage ?? 0), 0) !== 100) return fail(400, 10221, 'The percentages of a deployment\'s versions must add up to 100.');
  if (versions.some((v) => ctx.row(VERSION, String(v.version_id))?.script !== key)) return fail(404, 10220, 'A version of the deployment is not this Worker\'s.');
  const id = ctx.mint('workers_deployment');
  const deployment = { id, created_on: ctx.occurredAt, source: 'api', strategy: body.strategy ?? 'percentage', versions, annotations: (body.annotations as Row | undefined) ?? {}, author_email: callerEmail(ctx) };
  await ctx.write(DEPLOYMENT, id, { ...deployment, script: key }, 'worker_deployment.create');
  const serving = ctx.row(VERSION, String([...versions].sort((a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0))[0]?.version_id));
  if (serving && 'assets' in serving) await ctx.write(SCRIPT, key, { assets: serving.assets ?? null, modified_on: ctx.occurredAt }, 'worker_script.update');
  return ok(deployment);
}
