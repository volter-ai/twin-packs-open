// Stripe's own moves as time passes (docs/contributing/architecture.md, "What an author writes": clock), caught up to
// the World's clock before anything is answered, so every door (the API, the hosted pages) reads the account as it
// stands now. Each move is the engine's.
import type { HandlerContext } from '@volter/world-core';
import { advanceBilling, advancePayouts, lapseCoupons, lapseRealtimeRequests, settleBankDebits, settleHeldRefunds } from './shared.ts';
export async function clock(ctx: HandlerContext): Promise<void> {
  // a subscription renews at its period's end, its renewal charged an hour later
  await advanceBilling(ctx);
  // a submitted bank debit settles (in test mode at once)
  await settleBankDebits(ctx);
  // a coupon past its redeem_by is no longer valid
  await lapseCoupons(ctx);
  // a real-time authorization request no one answered is decided when its window ends
  await lapseRealtimeRequests(ctx);
  // a refund held for want of balance is made when funds cover it, before any payout takes them
  await settleHeldRefunds(ctx);
  // each account's automatic payouts
  await advancePayouts(ctx);
}
