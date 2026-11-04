import type { HandlerContext } from '@volter/world-core';
// source: recording:worker-source.txt "CLERK_API_URL?: string;"
// source: recording:deployment-source.txt "VGAI_ACCOUNT_CLIENT_ID = \"vgai-editor\""
// The deployment has no mutation API. Its client identity is fixed; provider and optional binding settings are operator input.
export async function configuration(ctx: HandlerContext): Promise<Response> {
  const b = ctx.body as Record<string, unknown>;
  const { clientId: _client, billingUrl: _legacyBilling, ...held } = ctx.get('_settings', 'deployment') ?? {};
  const allowed = ['clerkKey', 'publishableKey', 'clerkApi', 'providerClientId', 'authorizationEndpoint', 'tokenEndpoint', 'webCallback', 'billingBound', 'invitationRateLimit', 'authorizedParties', 'freePlan'];
  // source: recording:managed-account-app-source.txt "Catalog credits must be a non-negative integer:"
  if (b.freePlan !== undefined) {
    const plan = b.freePlan as Record<string, unknown>;
    if (!plan || typeof plan.name !== 'string' || !plan.name.trim() || !Number.isSafeInteger(plan.includedCredits) || Number(plan.includedCredits) < 0) return ctx.reply({ error: 'A Free catalog entry needs a name and non-negative integer includedCredits.' }, 400);
  }
  const fields = Object.fromEntries(allowed.filter(k => b[k] !== undefined).map(k => [k, b[k]]));
  await ctx.record('_settings', { ...held, ...fields }, 'deployment');
  return ctx.reply({ configured: true });
}
