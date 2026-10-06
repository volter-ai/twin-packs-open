// Balance and payout semantics. The balance is computed from the balance-transaction ledger (./ledger.ts), never
// stored: funds past their available_on are available, the rest pending, and Issuing funds their own section. The
// balance, the payouts and the ledger are the acting account's: the platform's, or a connected account's under the
// Stripe-Account header. A payout comes out of what that account has available and goes to its bank account, which a
// connected account must have (docs.stripe.com/connect/payouts-connected-accounts). A pending payout can be canceled,
// which returns its money; a connected account's paid payout can be reversed, which debits its bank account back
// into its balance (docs.stripe.com/api/payouts/reverse). The machine in ../manifest.ts says how a payout's status
// moves.
//
// Stripe also pays each account out on its own schedule (settings.payouts.schedule: daily by default, weekly or monthly
// on an anchor, or manual): an automatic payout takes what has become available since the last one, and the ledger
// lists the entries it paid (docs.stripe.com/payouts#payout-schedule, docs.stripe.com/connect/manage-payout-schedule).
// A connected account is paid out once it can be (payouts_enabled, with a bank account).
//
// Where the documentation stops and the twin decides: a payout arrives two days after it is made (Stripe's standard
// US schedule counts business days) and reads paid from then on; an automatic payout is made at midnight UTC on the
// first scheduled day on or after its funds become available, only when what it would pay is positive.
import type { Row } from './common.ts';
export const DAY = 86_400;

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** The first scheduled payout time on or after `from`: midnight UTC of a day the schedule pays out on. */
export function payoutDay(from: number, schedule: Row): number {
  const first = Math.ceil(from / DAY) * DAY;
  const pays = (day: number): boolean => {
    const d = new Date(day * 1000);
    if (schedule.interval === 'weekly') return DAYS[d.getUTCDay()] === String(schedule.weekly_anchor ?? 'monday');
    if (schedule.interval === 'monthly') return d.getUTCDate() === Math.min(Number(schedule.monthly_anchor ?? 1), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate());
    return true;
  };
  return Array.from({ length: 62 }, (_, i) => first + i * DAY).find(pays) ?? first;
}
