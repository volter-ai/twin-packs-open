import type { HandlerContext } from '@volter/world-core';
import { fail, identity, managedAdmission, participant, settings } from './shared.ts';
// source: recording:worker-source.txt "return json({ ...account, user, organizations }, 200, request, env);"
export async function accountProjection(ctx: HandlerContext): Promise<Response> {
  const userId = await identity(ctx); if (userId instanceof Response) return userId;
  const p = await participant(ctx, userId); if (!p) return fail(403, 'The authenticated VGAI account has no public profile.');
  const { organizations, ...user } = p; const config = settings(ctx);
  // source: recording:worker-source.txt "plan: { id: 'free', name: 'Free', status: 'free' },"
  if (!config.billingBound) return ctx.reply({ authenticated: true, backend: 'live', user, organizations, plan: { id: 'free', name: 'Free', status: 'free' }, credits: { included:0,purchased:0,used:0,reserved:0,remaining:0 }, spendPolicy: { overageEnabled:false,monthlyLimitCredits:0,alertThresholds:[] }, entitlements: { generation:true } });
  // source: recording:managed-account-readme-source.txt "A missing or malformed value prevents the ledger object"
  // source: recording:worker-source.txt "The managed VGAI account ledger is unavailable."
  if (!config.freePlan) return fail(503, 'The managed VGAI account ledger is unavailable.');
  const generation = await managedAdmission(ctx, userId);
  const held = ctx.row('Account', userId);
  // source: recording:managed-account-app-source.txt "account: this.database.upsertIdentity("
  // source: recording:managed-account-database-source.txt "ON CONFLICT(user_id) DO UPDATE SET"
  // source: recording:managed-account-app-source.txt "entitlements: { generation: account.managedServicesAllowed },"
  if (held) {
    const own = ctx.own(held);
    const fields = { ...own, user, organizations, entitlements: { generation } };
    if (JSON.stringify(fields) !== JSON.stringify(own)) await ctx.write('Account', userId, fields, 'accountProjection');
  } else {
    // source: recording:managed-account-database-source.txt "plan_status TEXT NOT NULL DEFAULT 'free'"
    // source: recording:managed-account-database-source.txt "alert_thresholds_json TEXT NOT NULL DEFAULT '[50,80,100]'"
    // source: recording:managed-account-app-source.txt "this.configuration.catalog.plans.free.includedCredits,"
    const included = config.freePlan.includedCredits;
    await ctx.write('Account', userId, { authenticated: true, backend: 'live', user, organizations,
      plan: { id: 'free', name: config.freePlan.name, status: 'free' },
      credits: { included, purchased: 0, used: 0, reserved: 0, remaining: included },
      spendPolicy: { overageEnabled: false, monthlyLimitCredits: 0, alertThresholds: [50,80,100] },
      alerts: [], entitlements: { generation } }, 'accountProjection');
  }
  return ctx.reply(ctx.own(ctx.row('Account', userId)!));
}
