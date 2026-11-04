import type { HandlerContext } from '@volter/world-core';
import { instanceEnvironment, instanceId, ms, sha256 } from './shared.ts';

type Row = Record<string, unknown>;

export async function makeSecretKey(ctx: HandlerContext, name: string | null): Promise<string> {
  const id = await ctx.issue('_secret_key');
  const mode = instanceEnvironment(ctx) === 'production' ? 'live' : 'test';
  const label = `secret_key:${id}:${name ?? ''}`;
  const secret = `sk_${mode}_${sha256(await ctx.secret(label)).slice(0, 40)}`;
  await ctx.record('_secret_key', { name, _instance: instanceId(ctx), _secret_label: label, _mode: mode, sha256: sha256(secret), created_at: ms(ctx) }, id);
  return id;
}

export async function readSecretKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row._instance !== instanceId(ctx) || typeof row._secret_label !== 'string' || (row._mode !== 'live' && row._mode !== 'test')) return undefined;
  const secret = `sk_${row._mode}_${sha256(await ctx.secret(row._secret_label)).slice(0, 40)}`;
  return sha256(secret) === row.sha256 ? secret : undefined;
}

/** The instance's native webhook signing key is bound to app endpoints when their URL is configured. */
export async function webhookKey(ctx: HandlerContext): Promise<Row> {
  const instance = instanceId(ctx);
  const held = ctx.rowsRaw('_webhook_signing_key').find((row) => row._instance === instance);
  if (held) return held;
  const id = await ctx.issue('_webhook_signing_key');
  const secret = `whsec_${Buffer.from(sha256(await ctx.secret(`webhook_secret:${id}`)).slice(0, 48), 'hex').toString('base64')}`;
  const made = await ctx.createUnique('_webhook_signing_key', { _instance: instance, signing_secret: secret, created_at: ms(ctx) }, 'webhook_signing_key.create', { id });
  return ctx.row('_webhook_signing_key', String(made.row.id))!;
}
