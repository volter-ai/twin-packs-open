// Stripe's accounts operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { externalList } from '../engine/common.ts';
import { controllerOf, expressRequirements, keptKyc } from '../engine/connect.ts';
import { ACCOUNT_TYPES, accountCapabilities, accountRequirements, accountSettings, nowUnix } from '../engine/stripe.ts';
import { accountMissing, accountRow, at, connectReview, created, fail, list, newest } from './shared.ts';
export async function GetAccountsAccountExternalAccounts(ctx: HandlerContext): Promise<Response> {
  const account = at(ctx, 'account');
  if (!accountRow(ctx, account)) return accountMissing(ctx, account);
  return list(ctx, 'external_account', newest(ctx, 'external_account').filter((e) => e.account === account));
}

// the requested capabilities become Stripe's status map, and settings its canonical shape
export async function PostAccounts(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const type = typeof params.type === 'string' ? params.type : 'standard';
  if (!ACCOUNT_TYPES.has(type)) return fail(ctx, 'Invalid account type: must be one of express, standard, or custom.', 400, 'parameter_invalid_string_enum');
  const { capabilities: _caps, settings: _settings, ...accountParams } = keptKyc(params);
  const id = ctx.mint('account');
  const made = await created(ctx, 'account', { ...accountParams, id, type }, {
    business_type: null, charges_enabled: false, payouts_enabled: false, details_submitted: false,
    capabilities: accountCapabilities(params), requirements: type === 'express' ? expressRequirements(params) : accountRequirements(),
    country: typeof params.country === 'string' ? params.country : 'US',
    default_currency: 'usd', email: params.email ?? null, metadata: {}, livemode: false,
    settings: accountSettings(params.settings), business_profile: {},
    controller: controllerOf(type), external_accounts: externalList(id, []),
    future_requirements: { alternatives: [], current_deadline: null, currently_due: [], disabled_reason: null, errors: [], eventually_due: [], past_due: [], pending_verification: [] },
    tos_acceptance: { date: null, ip: null, user_agent: null },
  });
  await connectReview(ctx, String(made.id));
  return ctx.reply(ctx.expand('account', ctx.get('account', String(made.id))!));
}

// a single-use Express dashboard link, not stored
export async function PostAccountsAccountLoginLinks(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'account');
  if (!ctx.get('account', id)) return accountMissing(ctx, id);
  return ctx.reply({ object: 'login_link', created: nowUnix(ctx.occurredAt), url: `https://connect.twin.local/express/${id}` });
}


// source: spec:PostAccountsAccount "left unchanged."
// source: https://docs.stripe.com/connect/account-capabilities "If a connected account has both card_payments and transfers"
