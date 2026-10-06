// Stripe's issuing operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { CARD, CH, cardNumberOf, cvcOf } from '../engine/issuing.ts';
import { emptySpendingControls, normalizeSpendingControls, nowUnix } from '../engine/stripe.ts';
import { at, created, fail, issuingDecide, issuingRefusal, send } from './shared.ts';

export async function GetIssuingCardsCard(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'card');
  const card = ctx.get(CARD, id);
  if (!card) return fail(ctx, `No such card: '${id}'`, 404, 'resource_missing');
  const expand = Array.isArray(ctx.params.expand) ? ctx.params.expand.map(String) : [];
  // source: spec:/components/schemas/issuing.card/properties/number/description "For security reasons, this is only available for virtual cards, and will be omitted unless you explicitly request it with"
  const virtual = card.type === 'virtual';
  const shown: Row = { ...card };
  if (virtual && expand.includes('number')) shown.number = cardNumberOf(await ctx.secret(`issuing-card-number:${id}`));
  // source: spec:/components/schemas/issuing.card/properties/cvc/description "The card's CVC. For security reasons, this is only available for virtual cards"
  if (virtual && expand.includes('cvc')) shown.cvc = cvcOf(await ctx.secret(`issuing-card-cvc:${id}`));
  return ctx.reply(ctx.expand(CARD, shown));
}

export async function PostIssuingAuthorizationsAuthorizationApprove(ctx: HandlerContext): Promise<Response> {
  return issuingDecide(true)(ctx);
}

export async function PostIssuingAuthorizationsAuthorizationDecline(ctx: HandlerContext): Promise<Response> {
  return issuingDecide(false)(ctx);
}

export async function PostIssuingCards(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  // source: spec:PostIssuingCards "The currency for the card."
  if (params.currency === undefined || params.currency === '') return fail(ctx, 'Missing required param: currency.', 400, 'parameter_missing');
  const cardType = typeof params.type === 'string' ? params.type : '';
  if (!cardType) return fail(ctx, 'Missing required param: type.', 400, 'parameter_missing');
  // source: spec:PostIssuingCards "The type of card to issue."
  if (cardType !== 'virtual' && cardType !== 'physical') return fail(ctx, "Invalid type: must be one of 'virtual' or 'physical'.", 400, 'parameter_invalid_string_enum');
  // the card answers its cardholder in full (the served spec's issuing.card.cardholder is the Cardholder object)
  const holder = typeof params.cardholder === 'string' ? params.cardholder : '';
  const cardholder = holder ? ctx.get(CH, holder) : undefined;
  if (holder && !cardholder) return fail(ctx, `No such cardholder: '${holder}'`, 400, 'resource_missing');
  const controls = normalizeSpendingControls(params.spending_controls, typeof params.currency === 'string' ? params.currency : null);
  if (controls.error) return send(ctx, controls.error);
  const id = ctx.mint(CARD);
  const number = cardNumberOf(await ctx.secret(`issuing-card-number:${id}`));
  // Where the documentation stops and the twin decides: a card expires three years after it is issued, at the end of
  // the month it was issued in.
  const issued = new Date(Number(nowUnix(ctx.occurredAt)) * 1000);
  return ctx.reply(ctx.expand(CARD, await created(ctx, CARD, { ...params, id, cardholder: holder || null, spending_controls: controls.controls ?? emptySpendingControls() }, {
    // source: https://docs.stripe.com/api/issuing/cards/create "Whether authorizations can be approved on this card. May be blocked from activating cards depending on past-due Cardholder requirements. Defaults to inactive."
    status: typeof params.status === 'string' ? params.status : 'inactive',
    livemode: false, metadata: {}, brand: 'Visa', last4: number.slice(-4),
    exp_month: issued.getUTCMonth() + 1, exp_year: issued.getUTCFullYear() + 3,
    cancellation_reason: null, replacement_for: null, replacement_reason: null, shipping: null, wallets: null,
  })));
}

// source: spec:PostIssuingCardsCard "Any parameters not provided will be left unchanged."
export async function PostIssuingCardsCard(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'card');
  const card = ctx.get(CARD, id);
  if (!card) return fail(ctx, `No such card: '${id}'`, 404, 'resource_missing');
  const { expand: _expand, ...fields } = ctx.params;
  // source: spec:/paths/~1v1~1issuing~1cards~1{card}/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/status "Dictates whether authorizations can be approved on this card."
  if (fields.status !== undefined && !['active', 'inactive', 'canceled'].includes(String(fields.status))) return issuingRefusal(ctx, 'card_status');
  if (fields.status !== undefined) {
    const refused = ctx.legal(CARD, 'status', 'PostIssuingCardsCard', card.status, String(fields.status), id);
    if (refused) return ctx.refuse(refused);
  }
  const controls = normalizeSpendingControls(fields.spending_controls, String(card.currency), card.spending_controls as Row);
  if (controls.error) return send(ctx, controls.error);
  return ctx.reply(ctx.expand(CARD, await ctx.write(CARD, id, { ...fields, ...(controls.controls ? { spending_controls: controls.controls } : {}) }, 'issuing.card.update')));
}
