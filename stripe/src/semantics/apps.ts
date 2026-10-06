// Stripe's apps operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { SECRET } from '../engine/apps-secrets.ts';
import type { Row } from '../engine/common.ts';
import { nowUnix } from '../engine/stripe.ts';
import { created, fail, named, scopeKeyOf } from './shared.ts';
export async function GetAppsSecretsFind(ctx: HandlerContext): Promise<Response> {
  const name = typeof ctx.params.name === 'string' ? ctx.params.name : '';
  if (!name) return fail(ctx, 'Missing required param: name.', 400, 'parameter_missing');
  const s = named(ctx, name);
  return s ? ctx.reply(s) : fail(ctx, `No such secret: '${name}'`, 404, 'resource_missing');
}

export async function PostAppsSecrets(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const name = typeof params.name === 'string' ? params.name : '';
  if (!name) return fail(ctx, 'Missing required param: name.', 400, 'parameter_missing');
  const scope = params.scope && typeof params.scope === 'object' ? (params.scope as Row) : undefined;
  const scopeType = scope && typeof scope.type === 'string' ? scope.type : '';
  if (scopeType !== 'account' && scopeType !== 'user') return fail(ctx, 'Invalid scope[type]: must be account or user.', 400, 'parameter_invalid_string_enum');
  if (scopeType === 'user' && typeof scope!.user !== 'string') return fail(ctx, 'Missing required param: scope[user].', 400, 'parameter_missing');
  if (params.payload === undefined) return fail(ctx, 'Missing required param: payload.', 400, 'parameter_missing');
  const expiresAt = params.expires_at !== undefined ? Math.trunc(Number(params.expires_at)) : null;
  const existing = named(ctx, name);
  if (existing) return ctx.reply(await ctx.write(SECRET, String(existing.id), { payload: params.payload, expires_at: expiresAt, _updated: nowUnix(ctx.occurredAt) }, 'apps_secret.update'));
  return ctx.reply(
    await created(ctx, SECRET, { name }, {
      livemode: false, deleted: false, expires_at: expiresAt, payload: params.payload,
      scope: scopeType === 'user' ? { type: 'user', user: scope!.user } : { type: 'account' },
      _scope_key: scopeKeyOf(ctx),
    }),
  );
}

export async function PostAppsSecretsDelete(ctx: HandlerContext): Promise<Response> {
  const name = typeof ctx.params.name === 'string' ? ctx.params.name : '';
  if (!name) return fail(ctx, 'Missing required param: name.', 400, 'parameter_missing');
  const s = named(ctx, name);
  if (!s) return fail(ctx, `No such secret: '${name}'`, 404, 'resource_missing');
  return ctx.reply(await ctx.write(SECRET, String(s.id), { deleted: true }, 'apps_secret.delete'));
}
