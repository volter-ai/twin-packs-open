import type { HandlerContext } from '@volter/world-core';
import { PLATFORM_ACCOUNT_ID } from '../engine/stripe.ts';
import { actingAccount, accountMissing } from './shared.ts';

// source: spec:GetAccount "Retrieves the details of an account."
export async function GetAccount(ctx: HandlerContext): Promise<Response> {
  const id = actingAccount(ctx) ?? PLATFORM_ACCOUNT_ID;
  const account = ctx.get('account', id);
  return account ? ctx.reply(ctx.expand('account', account)) : accountMissing(ctx, id);
}
