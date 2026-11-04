import type { HandlerContext } from '@volter/world-core';
import { platformAccountDefault } from '../engine/connect.ts';
import { requestKey } from '../engine/oauth.ts';
import { PLATFORM_ACCOUNT_ID } from '../engine/stripe.ts';

type Row = Record<string, unknown>;

/** Stripe's merchant account owns the sandboxes; Connect accounts live inside each sandbox. */
// source: https://docs.stripe.com/sandboxes
export async function credentialSandbox(ctx: HandlerContext): Promise<Row> {
  const merchant = await ctx.tenant('_merchant_account', async (organization) => {
    const profile = (id: string): Row => {
      const { id: _id, ...fields } = platformAccountDefault(id);
      return { ...fields, email: organization.members[0]!.toLowerCase(), business_profile: { name: organization.label } };
    };
    return organization.id === 'default'
      ? ctx.record('_merchant_account', profile(PLATFORM_ACCOUNT_ID), PLATFORM_ACCOUNT_ID)
      : String((await ctx.create('_merchant_account', profile, 'merchant_account.create')).id);
  });
  const organization = await ctx.account();
  return ctx.deploymentObject(`sandbox:${merchant.id}`, '_sandbox', async (deployment) => {
    const sandbox = await ctx.create('_sandbox', (id) => ({
      object: 'sandbox', account: merchant.id, name: deployment || (merchant.business_profile as Row).name,
      created: Math.floor(Date.parse(ctx.occurredAt) / 1000),
      _organization: organization, _deployment: deployment,
      _namespace: organization === 'default' && !deployment ? 'default' : id,
    }), 'sandbox.create');
    return String(sandbox.id);
  });
}

/** The native sandbox selected for this request, including an API-key-selected credential door. */
export function selectedSandbox(ctx: HandlerContext): Row | undefined {
  const platform = ctx.rowsRaw('account').find((row) => row._platform === true);
  if (typeof platform?._sandbox_id === 'string') return ctx.row('_sandbox', platform._sandbox_id);
  const key = requestKey(ctx.call.request);
  const held = key ? ctx.rowsRaw('_platform_key').find((row) => row._sha256 === ctx.crypto.sha256(key) && ['secret', 'publishable'].includes(String(row.kind))) : undefined;
  const body = ctx.body as Row | undefined;
  return ctx.rowsRaw('_sandbox').find((row) => held
    ? held.sandbox ? row.id === held.sandbox : row._namespace === held._sandbox
    : row._organization === (body?.account ?? 'default') && row._deployment === (body?.deployment ?? ''));
}

/** A sandbox exposes its merchant through Stripe's native Account API and hosted branding. */
export async function projectMerchant(ctx: HandlerContext, sandbox: Row): Promise<void> {
  const merchant = ctx.row('_merchant_account', String(sandbox.account))!;
  const id = String(merchant.id);
  const existing = ctx.row('account', id);
  if (!existing) {
    const { id: _id, ...base } = platformAccountDefault(id);
    await ctx.write('account', id, { ...base, email: merchant.email, business_profile: merchant.business_profile, _platform: true, _sandbox_id: sandbox.id }, 'account.provision');
  } else if (existing._platform !== true || existing._sandbox_id !== sandbox.id) {
    await ctx.write('account', id, { _platform: true, _sandbox_id: sandbox.id }, 'account.provision');
  }
}

export async function tenant(ctx: HandlerContext): Promise<string> {
  const path = new URL(ctx.call.request.url).pathname;
  const body = ctx.body as Row | undefined;
  const key = requestKey(ctx.call.request);
  if (path.startsWith('/_twin/') && (path === '/_twin/app-credentials' || body?.account !== undefined || body?.deployment !== undefined)) {
    return String((await credentialSandbox(ctx))._namespace);
  }
  if (key) {
    const held = ctx.rowsRaw('_platform_key').find((row) => row._sha256 === ctx.crypto.sha256(key) && ['secret', 'publishable'].includes(String(row.kind)));
    if (held) {
      if (path.startsWith('/_twin/') && held.sandbox === undefined) await credentialSandbox(ctx);
      return held._sandbox as string;
    }
  }
  if (path.startsWith('/_twin/')) return String((await credentialSandbox(ctx))._namespace);
  const segments = path.split('/').filter(Boolean);
  const session = /^\/setup\/s\/(onbs_[A-Za-z0-9_]+)\/?$/.exec(path)?.[1];
  const row = ['checkout.session', 'billing_portal.session', 'account_link']
    .flatMap((resource) => ctx.rowsRaw(resource))
    .find((row) => typeof row.id === 'string' && segments.includes(row.id))
    ?? (session ? ctx.rowsRaw('account_link').find((row) => row._session === session) : undefined);
  return (row?._sandbox as string | undefined) ?? 'default';
}

type KeyKind = 'secret' | 'publishable' | 'webhook' | 'connect_webhook';

const legacyLabel = (kind: KeyKind): string => ({
  secret: 'stripe-platform-key:app', publishable: 'stripe-publishable-key:app',
  webhook: 'stripe-webhook-secret:app', connect_webhook: 'stripe-webhook-secret:connect',
})[kind];

async function keyValue(ctx: HandlerContext, kind: KeyKind, label: string): Promise<string> {
  const value = (await ctx.secret(label)).replace(/[^A-Za-z0-9]/g, '');
  return kind === 'secret' ? `sk_test_51${value.slice(0, 96)}`
    : kind === 'publishable' ? `pk_test_51${value.slice(0, 96)}` : `whsec_${value.slice(0, 32)}`;
}

/** Reconstruct only a live, hash-verified native key belonging to this sandbox and role. */
async function readAppKey(ctx: HandlerContext, sandbox: Row, kind: KeyKind, row: Row): Promise<string | undefined> {
  if (row.deleted === true || row.kind !== kind || (row.sandbox !== undefined && row.sandbox !== sandbox.id)) return undefined;
  if (row.sandbox === undefined && sandbox._namespace !== 'default') return undefined;
  const label = typeof row._secretLabel === 'string' ? row._secretLabel : legacyLabel(kind);
  const secret = await keyValue(ctx, kind, label);
  return row._sha256 === ctx.crypto.sha256(secret) ? secret : undefined;
}

/** The native API/signing-key row is reserved before secret generation, including concurrent first use. */
async function makeAppKey(ctx: HandlerContext, sandbox: Row, kind: KeyKind): Promise<string> {
  const rows = ctx.rowsRaw('_platform_key', { withDeleted: true });
  const prior = rows.find((row) => row.deleted !== true && row.kind === kind && (row.sandbox === sandbox.id || (row.sandbox === undefined && sandbox._namespace === 'default')));
  if (prior) {
    const secret = await readAppKey(ctx, sandbox, kind, prior);
    if (secret !== undefined) {
      if (prior.sandbox !== sandbox.id || prior.account !== sandbox.account) await ctx.record('_platform_key', { sandbox: sandbox.id, account: sandbox.account }, String(prior.id));
      return String(prior.id);
    }
    if (prior._sha256 === undefined && typeof prior._secretLabel === 'string') {
      const value = await keyValue(ctx, kind, prior._secretLabel);
      await ctx.record('_platform_key', { _sha256: ctx.crypto.sha256(value) }, String(prior.id));
      return String(prior.id);
    }
    await ctx.record('_platform_key', { deleted: true }, String(prior.id));
  }
  const firstDefault = sandbox._namespace === 'default' && !rows.some((row) => row.kind === kind);
  const made = await ctx.createUnique('_platform_key', (id) => ({
    kind, sandbox: sandbox.id, account: sandbox.account, created: ctx.occurredAt,
    _secretLabel: firstDefault ? legacyLabel(kind) : `${legacyLabel(kind)}:${id}`,
  }), 'platform_key.create', { input: 'omit', ...(firstDefault ? { id: `${kind}:app` } : {}) });
  const row = ctx.row('_platform_key', String(made.row.id))!;
  const secret = await keyValue(ctx, kind, String(row._secretLabel));
  await ctx.record('_platform_key', { _sha256: ctx.crypto.sha256(secret) }, String(row.id));
  return String(row.id);
}

export async function retainedAppKey(ctx: HandlerContext, sandbox: Row, kind: KeyKind): Promise<string> {
  const key = await ctx.accountKey(kind, '_platform_key', {
    make: () => makeAppKey(ctx, sandbox, kind),
    read: (row) => readAppKey(ctx, sandbox, kind, row),
  });
  return key.secret;
}

/** Endpoint setup reads the sandbox's native role key; its request need not carry World selectors. */
export async function endpointSecret(ctx: HandlerContext, sandbox: Row, connect: boolean): Promise<string> {
  const kind = connect ? 'connect_webhook' : 'webhook';
  const id = await makeAppKey(ctx, sandbox, kind);
  return (await readAppKey(ctx, sandbox, kind, ctx.row('_platform_key', id)!))!;
}
