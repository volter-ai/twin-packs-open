// The Worker's Cron Trigger configuration, as the application's unchanged wrangler deploy installs it.
import type { HandlerContext } from '@volter/world-core';
import { accountOf, fail, noAccount, noScript, ok, type Row, SCRIPT, scriptOf, validCron } from './shared.ts';

// source: spec:worker-cron-trigger-get-cron-triggers "Get the schedules (Cron Triggers) for a Worker script."
export async function worker_cron_trigger_get_cron_triggers(ctx: HandlerContext): Promise<Response> {
  if (!accountOf(ctx)) return noAccount();
  const script = scriptOf(ctx);
  if (!script) return noScript();
  return ok({ schedules: script.schedules ?? [] });
}

// source: spec:worker-cron-trigger-update-cron-triggers "Update the schedules (Cron Triggers) for a Worker script."
export async function worker_cron_trigger_update_cron_triggers(ctx: HandlerContext): Promise<Response> {
  if (!accountOf(ctx)) return noAccount();
  const script = scriptOf(ctx);
  if (!script) return noScript();
  // Where the vendor's spec stops: its failure schema names no code for a malformed schedule; use the API's
  // source: spec:worker-cron-trigger-update-cron-triggers "Update Cron Triggers response failure."
  // generic Workers configuration error. Cron execution belongs to the compute service, not this stored API config.
  if (!Array.isArray(ctx.body) || ctx.body.some((s) => !s || typeof s !== 'object' || typeof s.cron !== 'string' || !validCron(s.cron))) return fail(400, 10000, 'Invalid Cron Trigger configuration.');
  const prior = (script.schedules ?? []) as Row[];
  // source: spec:/components/schemas/workers_schedule/properties/created_on "readOnly"
  const schedules = (ctx.body as Row[]).map((s) => ({ cron: s.cron, created_on: prior.find((p) => p.cron === s.cron)?.created_on ?? ctx.occurredAt, modified_on: ctx.occurredAt }));
  await ctx.write(SCRIPT, String(script.id), { schedules }, 'worker.schedules.update');
  return ok({ schedules });
}
