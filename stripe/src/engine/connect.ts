// Connect semantics: connected accounts (and the platform's own account), their persons,
// capabilities, external (payout) accounts, login links, onboarding links and embedded-component
// sessions. A new connected account is not yet active: charges and payouts are off and its
// requirements are outstanding, as on Stripe before onboarding. Account retrieve and delete and
// the person list are the derived core's.
import { accountRequirements, accountSettings, PLATFORM_ACCOUNT_ID } from './stripe.ts';
import { currentlyDue, kindOf } from './onboarding.ts';
import { externalList, type Row } from './common.ts';
// the platform's own account: stored once it is written, otherwise Stripe's default. It "controls itself" (controller
// type `account`, docs.stripe.com/api/accounts/object), is fully onboarded with nothing due, and takes card payments
// and transfers. Where the documentation stops and the twin decides: it was created as the World began (2026-01-01),
// and its bank account, which its automatic payouts reach, is not modelled, so it lists none.
export const PLATFORM_CREATED = 1_767_225_600;
/** The platform's own account as Stripe's default has it, before anything is written to it. */
export const platformAccountDefault = (): Row => ({
  object: 'account', id: PLATFORM_ACCOUNT_ID, type: 'standard', country: 'US', default_currency: 'usd', created: PLATFORM_CREATED,
  charges_enabled: true, payouts_enabled: true, details_submitted: true, email: null, metadata: {},
  capabilities: { card_payments: 'active', transfers: 'active' }, controller: { type: 'account' },
  requirements: { alternatives: [], current_deadline: null, currently_due: [], disabled_reason: null, errors: [], eventually_due: [], past_due: [], pending_verification: [] },
  future_requirements: { alternatives: [], current_deadline: null, currently_due: [], disabled_reason: null, errors: [], eventually_due: [], past_due: [], pending_verification: [] },
  external_accounts: externalList(PLATFORM_ACCOUNT_ID, []), tos_acceptance: { date: null, ip: null, user_agent: null }, business_profile: {},
  settings: accountSettings(undefined), livemode: false,
});

/** A new Express account owes what its hosted onboarding will ask for (screens/connect-onboarding.tsx; the US sets
 *  docs.stripe.com/connect/required-verification-information lists), or, where the twin does not model the set, the
 *  generic list. */
export function expressRequirements(params: Row): Row {
  const kind = kindOf({ country: params.country ?? 'US', business_type: params.business_type ?? 'individual' });
  const base = accountRequirements();
  return kind ? { ...base, currently_due: currentlyDue(kind), eventually_due: currentlyDue(kind) } : base;
}

/** The controller an account made with a `type` has: "Each of the three account types maps to values in the
 *  `controller` hash", Standard to losses.payments `stripe`, fees.payer `account`, requirement_collection `stripe` and
 *  a `full` dashboard, Express to `application`, `application_express`, `stripe` and `express`, Custom to
 *  `application`, `application_custom`, `application` and `none`; each "type": "application", "is_controller": true
 *  (docs.stripe.com/connect/migrate-to-controller-properties). */
export function controllerOf(type: string): Row {
  const [losses, payer, collection, dashboard] = type === 'express' ? ['application', 'application_express', 'stripe', 'express']
    : type === 'custom' ? ['application', 'application_custom', 'application', 'none'] : ['stripe', 'account', 'stripe', 'full'];
  return { type: 'application', is_controller: true, losses: { payments: losses }, fees: { payer }, requirement_collection: collection, stripe_dashboard: { type: dashboard } };
}

/** What a Custom account still owes, from what the platform has given for it, as Stripe's requirements endpoint lists it
 *  for a US account with no Stripe Dashboard and the full service agreement
 *  (docs.stripe.com/_endpoint/get-requirements-for-setups, the data behind
 *  docs.stripe.com/connect/required-verification-information). With transfers alone, a company owes business_profile.url,
 *  company.name, an external account and tos_acceptance.date and .ip at once (capability_limit_amount -1: paused until
 *  given) and company.tax_id before $3,000 of payouts (payout_limit_amount 300000); an individual owes the url, its
 *  first and last name, the bank account and the terms at once, and its date of birth and ssn_last_4 before $3,000 of
 *  payouts. Requesting card_payments adds business_profile.mcc and the entity's address at once (and an individual's
 *  email and ssn_last_4). A company with card_payments owes, at once, business_profile.mcc, its address, that its owners
 *  are provided, each owner's name and email, and its representative's name, email, address, title and ssn_last_4; and
 *  in time its phone, its statement descriptor and its representative's date of birth and phone (the endpoint's answer
 *  for US / dashboard none / full terms / company / card_payments and transfers, saved in scratch as
 *  req-custom-company-cards-transfers.json: capability_limit_amount -1 for the first, none for the second). The
 *  representative and the owners are the account's persons (relationship.representative, relationship.owner).
 *  Where the documentation stops and the twin decides: what has no limit, or is owed before $3,000 of payouts, is
 *  eventually_due and blocks nothing (the twin keeps no payout total against it); an owner field is met when every
 *  person marked owner has it (none marked: met). */
export const at_path = (a: Row, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Row)[k] : undefined), a);
export const CARD_COMPANY_NOW = ['business_profile.mcc', 'company.address.line1', 'company.address.city', 'company.address.state', 'company.address.postal_code', 'company.owners_provided', 'owners.first_name', 'owners.last_name', 'owners.email', 'representative.first_name', 'representative.last_name', 'representative.email', 'representative.address.line1', 'representative.address.city', 'representative.address.state', 'representative.address.postal_code', 'representative.relationship.title', 'representative.ssn_last_4'];
export const CARD_COMPANY_LATER = ['company.phone', 'settings.payments.statement_descriptor', 'representative.dob.day', 'representative.dob.month', 'representative.dob.year', 'representative.phone'];
export const CARD_INDIVIDUAL_NOW = ['business_profile.mcc', 'individual.address.line1', 'individual.address.city', 'individual.address.state', 'individual.address.postal_code', 'individual.email', 'individual.ssn_last_4'];
export const personHas = (p: Row, field: string): boolean => {
  if (field === 'ssn_last_4') return p.ssn_last_4_provided === true;
  const v = at_path(p, field);
  return v !== undefined && v !== null && v !== '';
};
export const met = (a: Row, bank: boolean, field: string, persons: Row[] = []): boolean => {
  if (field === 'external_account') return bank;
  if (field.startsWith('representative.')) {
    const rep = persons.find((p) => (p.relationship as Row | undefined)?.representative === true);
    return !!rep && personHas(rep, field.slice('representative.'.length));
  }
  if (field.startsWith('owners.')) return persons.filter((p) => (p.relationship as Row | undefined)?.owner === true).every((p) => personHas(p, field.slice('owners.'.length)));
  if (field === 'company.tax_id') return at_path(a, 'company.tax_id_provided') === true;
  if (field === 'individual.ssn_last_4') return at_path(a, 'individual.ssn_last_4_provided') === true;
  const v = at_path(a, field);
  return v !== undefined && v !== null && v !== '';
};
export function customRequirements(a: Row, bank: boolean, persons: Row[] = []): { now: string[]; later: string[] } {
  const company = a.business_type === 'company';
  const cards = Object.keys((a.capabilities as Row | undefined) ?? {}).includes('card_payments');
  const now = ['business_profile.url', ...(company ? ['company.name'] : ['individual.first_name', 'individual.last_name']), 'external_account', 'tos_acceptance.date', 'tos_acceptance.ip'];
  if (cards) now.push(...(company ? CARD_COMPANY_NOW : CARD_INDIVIDUAL_NOW));
  const later = [...(company ? ['company.tax_id'] : ['individual.dob.day', 'individual.dob.month', 'individual.dob.year', 'individual.ssn_last_4']), ...(cards && company ? CARD_COMPANY_LATER : [])].filter((f) => !now.includes(f));
  return { now: now.filter((f) => !met(a, bank, f, persons)), later: later.filter((f) => !met(a, bank, f, persons)) };
}

/** A request's company or individual as Stripe keeps it: a tax id or SSN given is kept only as provided (the Account
 *  object answers company.tax_id_provided and individual.ssn_last_4_provided, never the numbers;
 *  docs.stripe.com/api/accounts/object). */
export function keptKyc(params: Row): Row {
  const out: Row = { ...params };
  if (params.company && typeof params.company === 'object') {
    const { tax_id, ...company } = params.company as Row;
    out.company = { ...company, ...(tax_id !== undefined && tax_id !== '' ? { tax_id_provided: true } : {}) };
  }
  if (params.individual && typeof params.individual === 'object') {
    const { ssn_last_4, id_number, ...individual } = params.individual as Row;
    out.individual = { ...individual, ...(ssn_last_4 !== undefined && ssn_last_4 !== '' ? { ssn_last_4_provided: true } : {}), ...(id_number !== undefined && id_number !== '' ? { id_number_provided: true } : {}) };
  }
  return out;
}
