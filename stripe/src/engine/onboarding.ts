// What a connected account owes Stripe before it can take payments (the requirements its onboarding collects,
// ../screens/connect-onboarding.tsx), as the Accounts API reports them (`requirements.currently_due`): the two US sets the twin
// models, a company's and an individual's.
import { INDUSTRIES as MCCS } from './industries.ts';
type Row = Record<string, unknown>;

export const OFFERED = new Set(MCCS.map(([mcc]) => mcc));

export type Form = Record<string, string>;

export type Kind = 'company' | 'individual';

export const has = (v: Form, k: string): boolean => (v[k] ?? '').trim() !== '';

export const dobPart = (v: Form, i: number): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v.dob ?? '') && Number((v.dob ?? '').split('-')[i]) > 0;

/** Each requirement Stripe names, the form's answer that meets it, and which of the two sets it belongs to. */
export const REQUIREMENTS: Array<[string, (v: Form) => boolean, Kind[]]> = [
  ['business_profile.mcc', (v) => OFFERED.has((v.mcc ?? '').trim()), ['company', 'individual']],
  ['business_profile.url', (v) => has(v, 'url'), ['company', 'individual']],
  ['settings.payments.statement_descriptor', (v) => has(v, 'statement_descriptor'), ['company', 'individual']],
  ['company.name', (v) => has(v, 'company_name'), ['company']],
  ['company.tax_id', (v) => has(v, 'company_tax_id'), ['company']],
  ['company.phone', (v) => has(v, 'company_phone'), ['company']],
  ['company.address.line1', (v) => has(v, 'company_line1'), ['company']],
  ['company.address.city', (v) => has(v, 'company_city'), ['company']],
  ['company.address.state', (v) => has(v, 'company_state'), ['company']],
  ['company.address.postal_code', (v) => has(v, 'company_postal_code'), ['company']],
  ['company.owners_provided', (v) => v.owners_provided === 'provided', ['company']],
  ['owners.first_name', (v) => has(v, 'owner_first_name'), ['company']],
  ['owners.last_name', (v) => has(v, 'owner_last_name'), ['company']],
  ['owners.email', (v) => has(v, 'owner_email'), ['company']],
  ...(['first_name', 'last_name', 'email', 'phone'] as const).flatMap((f): Array<[string, (v: Form) => boolean, Kind[]]> => [[`representative.${f}`, (v) => has(v, f), ['company']], [`individual.${f}`, (v) => has(v, f), ['individual']]]),
  ...(['day', 'month', 'year'] as const).flatMap((f, i): Array<[string, (v: Form) => boolean, Kind[]]> => [[`representative.dob.${f}`, (v) => dobPart(v, 2 - i), ['company']], [`individual.dob.${f}`, (v) => dobPart(v, 2 - i), ['individual']]]),
  ...(['line1', 'city', 'state', 'postal_code'] as const).flatMap((f): Array<[string, (v: Form) => boolean, Kind[]]> => [[`representative.address.${f}`, (v) => has(v, f), ['company']], [`individual.address.${f}`, (v) => has(v, f), ['individual']]]),
  ['representative.relationship.title', (v) => has(v, 'title'), ['company']],
  ['representative.ssn_last_4', (v) => /^\d{4}$/.test(v.ssn_last_4 ?? ''), ['company']],
  ['individual.ssn_last_4', (v) => /^\d{4}$/.test(v.ssn_last_4 ?? ''), ['individual']],
  ['tos_acceptance.date', (v) => v.tos === 'accepted', ['company', 'individual']],
  ['tos_acceptance.ip', (v) => v.tos === 'accepted', ['company', 'individual']],
  ['external_account', (v) => has(v, 'routing_number') && has(v, 'account_number'), ['company', 'individual']],
];

/** The set an account onboards against: the two US sets the twin models, or none. */
export function kindOf(account: Row): Kind | undefined {
  const type = account.business_type ?? 'individual';
  return (account.country ?? 'US') === 'US' && (type === 'company' || type === 'individual') ? type : undefined;
}

/** What an account of this kind still owes, given the form's answers (none: all of it). */
export function currentlyDue(kind: Kind, v: Form = {}): string[] {
  return REQUIREMENTS.filter(([, met, kinds]) => kinds.includes(kind) && !met(v)).map(([req]) => req);
}
