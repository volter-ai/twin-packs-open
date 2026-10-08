// STRIPE CONNECT HOSTED ONBOARDING — a hosted flow (docs/contributing/architecture.md, "Screens"): a platform
// creates an Account Link for a connected account and sends the account's owner to its `url`. The link is a
// single-use entry point: visiting it takes the owner to their onboarding session, and visiting it again, or after it
// expires, sends them to refresh_url, where the platform makes a new one (docs.stripe.com/connect/hosted-onboarding).
// At the session's own address they give Stripe what it requires, and Stripe sends them to return_url. Submitting is
// the owner's move, not an API call. Authored from @volter/world-ui's payment piece and Stripe's published visual
// example; the form moves through one section at a time, retaining answers until the final submit.
//
// The page asks for exactly what Stripe requires before a US Express account with card_payments and transfers can
// take card payments (docs.stripe.com/connect/required-verification-information; the set is the one Stripe's
// requirements endpoint answers, docs.stripe.com/_endpoint/get-requirements-for-setups with apiVersion=v1,
// platformCountry=US, accountCountry=US, dashboardType=express, tosType=full, capabilities card_payments and transfers):
// thirty requirements for a company (the business profile, the statement descriptor, the company with its tax id,
// phone and address, its owners, its representative with their title and address, the agreement and the payout bank
// account) and eighteen for an individual. A submit that leaves any out is refused with what is missing. The account's
// requirements.currently_due lists what is still missing, and charges and payouts are enabled, and its requested
// capabilities become active (Stripe's move on the capability machine), only once none is. The agreement is the
// page's own checkbox, recorded as tos_acceptance with the request's address and the time.
//
// Where the documentation stops and the twin decides: only these two US sets are modelled; an account elsewhere, or
// of another business type, is told its requirements are not modelled. Test mode verifies at once whatever is
// submitted (docs.stripe.com/connect/testing lists the values that pass: date of birth 1901-01-01, SSN last four
// 0000, tax id 000000000, routing 110000000, account 000123456789); the industries offered are Stripe's supported
// merchant category codes as its list gives them (./industries.ts), and an industry the page does not offer leaves
// business_profile.mcc due; the states are the fifty and the District of Columbia; a request with no forwarded address
// records 127.0.0.1. An update link (account_update) shows the same page.
import { twinVendorUrl, type HandlerContext } from '@volter/world-core';
import { CONSENT_CSS, flowPage, Payment, PAYMENT_CSS, type PaymentProps, type PaymentField } from '@volter/world-ui';
import type { Row } from '../engine/common.ts';
import { nowUnix } from '../engine/stripe.ts';
import { formOf, notFound, seeOther, STRIPE_CONSENT_SKIN } from './shared.tsx';
import { INDUSTRIES as MCCS } from '../engine/industries.ts';
import { currentlyDue, type Form, type Kind, kindOf, OFFERED } from '../engine/onboarding.ts';
import { created, syncExternals } from '../semantics/shared.ts';
const LINK = 'account_link';

const gone = (): Response => flowPage({ title: 'Stripe', status: 404, css: [CONSENT_CSS, STRIPE_CONSENT_SKIN], body: <main className="consent"><h1 className="consent-heading">This link is invalid.</h1></main> });

/** A link that can still be used: not used and not past its expiry. */
const usable = (ctx: HandlerContext, link: Row): boolean => link.used !== true && Number(link.expires_at) > nowUnix(ctx.occurredAt);

// the field asks, with no industry chosen until the person chooses one (an unanswered field leaves the MCC due)
const INDUSTRIES = [{ value: '', label: 'Select your industry' }, ...MCCS.map(([value, label]) => ({ value, label }))];
// the fifty states and the District of Columbia, by their USPS codes (the address's `state`, ISO 3166-2 without its
// country, docs.stripe.com/api/accounts/object)
const STATES = ([
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const).map(([value, label]) => ({ value, label }));

const field = (id: string, label: string, v: Form, extra: Partial<PaymentField> = {}): PaymentField => ({ id, label, value: v[id] ?? '', ...extra });
const addressFields = (prefix: string, v: Form): PaymentField[] => [
  field(`${prefix}line1`, 'Address', v, { autoComplete: 'address-line1' }), field(`${prefix}city`, 'City', v),
  field(`${prefix}state`, 'State', v, { options: STATES, value: v[`${prefix}state`] ?? 'OR' }), field(`${prefix}postal_code`, 'ZIP', v, { autoComplete: 'postal-code' }),
];

/** The industry the field shows: what the form sent, else what the account already holds, when the page offers it. */
const industryOf = (mcc: unknown): string => (typeof mcc === 'string' && OFFERED.has(mcc.trim()) ? mcc.trim() : '');

function page(ctx: HandlerContext, sessionUrl: string, link: Row, kind: Kind, values: Form = {}, error?: string): Response {
  const v = values;
  const business: PaymentField[] = [
    field('mcc', 'Industry', v, { options: INDUSTRIES, value: industryOf(v.mcc ?? (ctx.get('account', String(link.account))?.business_profile as Row | undefined)?.mcc) }),
    field('url', 'Business website', v, { placeholder: 'https://' }),
    field('statement_descriptor', 'Statement descriptor (what customers see on their card statements)', v),
  ];
  const company: PaymentField[] = [
    field('company_name', 'Legal business name', v), field('company_tax_id', 'Employer Identification Number (EIN)', v), field('company_phone', 'Business phone', v, { type: 'tel' }),
    ...addressFields('company_', v),
  ];
  const owners: PaymentField[] = [
    field('owner_first_name', 'Owner first name', v), field('owner_last_name', 'Owner last name', v), field('owner_email', 'Owner email', v, { type: 'email' }),
    field('owners_provided', 'All owners of 25% or more are listed', v, { type: 'checkbox', value: 'provided' }),
  ];
  const person: PaymentField[] = [
    field('first_name', 'First name', v, { autoComplete: 'given-name' }), field('last_name', 'Last name', v, { autoComplete: 'family-name' }),
    field('email', 'Email', v, { type: 'email' }), field('phone', 'Phone', v, { type: 'tel' }), field('dob', 'Date of birth', v, { type: 'date' }),
    ...(kind === 'company' ? [field('title', 'Job title', v)] : []),
    ...addressFields('', v), field('ssn_last_4', 'Last 4 digits of SSN', v),
  ];
  const payout: PaymentField[] = [field('routing_number', 'Routing number', v), field('account_number', 'Account number', v)];
  const agreement: PaymentField[] = [field('tos', 'I agree to the Stripe Connected Account Agreement', v, { type: 'checkbox', value: 'accepted' })];
  const sections = kind === 'company'
    ? [{ heading: 'Business details', fields: business }, { heading: 'Company', fields: company }, { heading: 'Owners', fields: owners }, { heading: 'Representative', fields: person }, { heading: 'Payout account', fields: payout }, { heading: 'Agreement', fields: agreement }]
    : [{ heading: 'Business details', fields: business }, { heading: 'About you', fields: person }, { heading: 'Payout account', fields: payout }, { heading: 'Agreement', fields: agreement }];
  return flowPage({
    title: 'Stripe · Account onboarding',
    css: [ONBOARDING_CSS],
    ...(error ? { status: 400 } : {}),
    body: (
      <ConnectOnboarding
        merchant="Stripe"
        account={String(link.account)}
        checked={['owners_provided', 'tos'].filter(name => v[name] === (name === 'tos' ? 'accepted' : 'provided'))}
        lines={sections.map(section => ({ name: section.heading, amount: '' }))}
        action={sessionUrl}
        sections={sections}
        submit={{ label: 'Submit' }}
        back={{ href: String(link.return_url), label: '← Return to platform' }}
        {...(error ? { error } : {})}
      />
    ),
  });
}

/** An account whose requirements the twin does not model: outside the US, or of another business type. */
function unmodelled(account: Row): Response {
  return flowPage({ title: 'Stripe', status: 501, css: [CONSENT_CSS, STRIPE_CONSENT_SKIN], body: <main className="consent"><h1 className="consent-heading">{`Onboarding requirements for a ${String(account.business_type ?? 'business')} account in ${String(account.country ?? 'this country')} are not modelled by this twin.`}</h1></main> });
}

/** A submit that leaves something out is refused on the page with what is missing, the owner's answers kept. */
function incomplete(ctx: HandlerContext, sessionUrl: string, link: Row, kind: Kind, v: Form, missing: string[]): Response {
  return page(ctx, sessionUrl, link, kind, v, `Still required: ${missing.join(', ')}.`);
}

/** The owner submits everything: it is stored on the account, nothing is due, and charges, payouts and the requested
 *  capabilities are enabled. */
async function submit(ctx: HandlerContext, link: Row, kind: Kind, v: Form, ip: string): Promise<void> {
  const id = String(link.account);
  const account = ctx.get('account', id);
  if (!account) return;
  const caps: Row = { ...((account.capabilities as Row | undefined) ?? {}) };
  for (const [cap, status] of Object.entries(caps)) {
    if (status !== 'active') caps[cap] = 'active';
  }
  const due = currentlyDue(kind, v);
  const requirements = { ...((account.requirements as Row | undefined) ?? {}), currently_due: due, eventually_due: due, past_due: [], disabled_reason: null, current_deadline: null };
  const addressOf = (p: string): Row => ({ line1: v[`${p}line1`], line2: null, city: v[`${p}city`], state: v[`${p}state`], postal_code: v[`${p}postal_code`], country: 'US' });
  const [year, month, day] = (v.dob ?? '').split('-').map(Number);
  const person = { first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone, dob: { day, month, year }, address: addressOf(''), ssn_last_4_provided: true, id_number_provided: false };
  const company = kind === 'company';
  const settings = (account.settings as Row | undefined) ?? {};
  const individual = company ? null : await created(ctx, 'person', { ...person, account: id }, { relationship: { representative: true }, metadata: {} });
  await ctx.write('account', id, {
    details_submitted: true, charges_enabled: due.length === 0, payouts_enabled: due.length === 0, capabilities: caps, requirements,
    business_type: kind,
    business_profile: { ...((account.business_profile as Row | undefined) ?? {}), name: company ? v.company_name : `${String(v.first_name)} ${String(v.last_name)}`, mcc: (v.mcc ?? '').trim(), url: v.url },
    settings: { ...settings, payments: { ...((settings.payments as Row | undefined) ?? {}), statement_descriptor: v.statement_descriptor } },
    ...(company
      ? { company: { name: v.company_name, phone: v.company_phone, address: addressOf('company_'), tax_id_provided: true, owners_provided: true, directors_provided: false, executives_provided: false } }
      : { individual: individual!.id }),
    tos_acceptance: { date: nowUnix(ctx.occurredAt), ip, user_agent: null },
  }, 'account.updated');
  if (company) {
    await created(ctx, 'person', { account: id }, { ...person, relationship: { representative: true, executive: true, director: false, owner: false, percent_ownership: null, title: v.title }, metadata: {} });
    await created(ctx, 'person', { account: id }, { first_name: v.owner_first_name, last_name: v.owner_last_name, email: v.owner_email, relationship: { owner: true, representative: false, executive: false, director: false, percent_ownership: null, title: null }, metadata: {} });
  }
  const digits = (v.account_number ?? '').replace(/\D/g, '');
  await created(ctx, 'external_account', { account: id }, {
    object: 'bank_account', account_holder_name: company ? v.company_name : `${String(v.first_name)} ${String(v.last_name)}`, account_holder_type: company ? 'company' : 'individual', bank_name: 'STRIPE TEST BANK', country: 'US', currency: 'usd',
    default_for_currency: true, fingerprint: `twin_ext_${digits.slice(-4)}`, last4: digits.slice(-4), routing_number: v.routing_number, status: 'new', metadata: {},
  });
  await syncExternals(ctx, id);
}

/** Where an onboarding session lives, on connect.stripe.com. */
const SESSIONS = 'https://connect.stripe.com/setup/s/';

/** Visiting an Account Link consumes it and sends the owner to their onboarding session; a used or expired one sends
 *  them to refresh_url for a fresh link. */
async function visit(ctx: HandlerContext, id: string): Promise<Response> {
  const link = ctx.get(LINK, id);
  if (!link) return gone();
  if (!usable(ctx, link)) return seeOther(String(link.refresh_url));
  const session = `onbs_${id.replace(/^acctlink_/, '')}`;
  await ctx.write(LINK, id, { used: true, _session: session }, 'account_link.used');
  return seeOther(twinVendorUrl(ctx.call.request, `${SESSIONS}${session}`));
}

/** connect.stripe.com's onboarding pages, or undefined for any other request. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const path = new URL(request.url).pathname;
  const entry = /^\/setup\/(acctlink_[A-Za-z0-9_]+)\/?$/.exec(path);
  const at = /^\/setup\/s\/(onbs_[A-Za-z0-9_]+)\/?$/.exec(path);
  if (entry && request.method === 'GET') return visit(ctx, entry[1]!);
  if (!at || (request.method !== 'GET' && request.method !== 'POST')) return notFound();
  const sid = at[1]!;
  const form = request.method === 'POST' ? await formOf(request.clone()) : {};
  // the session the visited link opened, until it is submitted
  const stored = ctx.rowsRaw(LINK).find((l) => l._session === sid && l._submitted !== true);
  const link = stored ? ctx.get(LINK, String(stored.id)) : undefined;
  if (!stored || !link) return gone();
  const sessionUrl = twinVendorUrl(request, `${SESSIONS}${sid}`);
  const account = ctx.get('account', String(link.account)) ?? {};
  const kind = kindOf(account);
  if (!kind) return unmodelled(account);
  if (request.method === 'GET') return page(ctx, sessionUrl, link, kind);
  const missing = currentlyDue(kind, form);
  if (missing.length) return incomplete(ctx, sessionUrl, link, kind, form, missing);
  await ctx.write(LINK, String(stored.id), { _submitted: true }, 'account_link.submitted');
  await submit(ctx, link, kind, form, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1');
  return seeOther(String(link.return_url));
}

// Visual reference: Stripe's own hosted onboarding example, read 2026-10-08:
// https://docs.stripe.com/connect/hosted-onboarding
// hosted_onboarding_form.e59ba8300f563e43489953f06127f52c.png. Platform branding
// in that example is configurable; this twin uses its existing Stripe skin.

const ONBOARDING_CSS = PAYMENT_CSS + `
*{box-sizing:border-box}body{color:#30313d;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.pay{grid-template-columns:minmax(280px,40%) minmax(0,60%)}.pay-summary{background:#f7f7f9;padding:48px max(32px,calc((100vw - 1000px)/2));padding-right:40px;position:relative}
.pay-back{color:#596171;font-size:13px;margin-bottom:40px}.pay-merchant{color:#635bff;font-size:30px;font-weight:700;letter-spacing:-1px;margin-bottom:32px}
.pay-lines{counter-reset:step;max-width:280px}.pay-line{counter-increment:step;display:block;position:relative;padding:12px 0 12px 38px;color:#687385;font-size:14px}
.pay-line::before{content:counter(step);position:absolute;left:0;top:11px;width:24px;height:24px;line-height:22px;text-align:center;border:1px solid #d8dee4;border-radius:50%;background:#fff;font-size:12px}
.pay-line[aria-current=step]{color:#30313d;font-weight:600}.pay-line[aria-current=step]::before{border-color:#635bff;color:#635bff}.pay-line.is-complete::before{background:#635bff;border-color:#635bff;color:#fff}
.pay-form{padding:56px 48px;max-width:620px;width:100%}.pay-section legend{font-size:26px;letter-spacing:-.6px;font-weight:600;margin-bottom:24px}.pay-field{margin-bottom:22px}
.pay-field span{font-size:14px;margin-bottom:8px;font-weight:500}.pay-field input,.pay-field select{background:#fff;border-color:#d8dee4;border-radius:6px;padding:10px 12px;box-shadow:0 1px 2px #00000005;color:#30313d}
.pay-field input:focus,.pay-field select:focus{outline:2px solid #a5a0ff;outline-offset:1px}
.pay-field:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:10px}.pay-field:has(input[type=checkbox]) span{order:2;font-weight:400}.pay-field input[type=checkbox]{width:16px;height:16px;flex:none;margin-top:3px;accent-color:#635bff}
.pay-submit,.connect-next{background:#635bff;color:#fff;border:0;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;padding:12px 16px}
.connect-actions{display:flex;justify-content:space-between;gap:16px;margin-top:32px}.connect-back{color:#596171;background:transparent;border:0;cursor:pointer;padding:12px 0;font:inherit}.connect-next{min-width:140px;flex:1}
.pay-error{border:1px solid #f1c2c2;padding:12px;border-radius:6px;color:#b52e2e;background:#fff7f7;font-size:13px;white-space:normal;overflow-wrap:anywhere}
.connect-progress{height:3px;background:#ececf1;margin:0 0 36px;border-radius:2px;overflow:hidden}.connect-progress div{height:100%;background:#635bff;transition:width .15s}
.connect-context{position:absolute;bottom:40px;left:32px;color:#687385;font-size:12px}.connect-context strong{display:block;font-weight:500;color:#30313d}
.connect-ready .pay-section[hidden],.connect-ready .pay-submit[hidden],.connect-actions [hidden]{display:none}
@media(max-width:800px){.pay{grid-template-columns:1fr}.pay-summary{padding:24px}.pay-back{margin-bottom:20px}.pay-merchant{font-size:24px;margin-bottom:0}.pay-lines{display:none}.connect-context{position:static;padding:0 24px;background:#f7f7f9}.pay-form{padding:32px 24px;max-width:100%}.pay-section legend{font-size:24px}}
`;

// Progressive enhancement only: Back/Continue move through the existing form.
// No account state is written until its existing Submit operation succeeds.
const STEPS = `(function(){
var root=document.querySelector('.connect-onboarding'),form=root.querySelector('form'),groups=Array.from(form.querySelectorAll('.pay-section')),items=Array.from(root.querySelectorAll('.pay-line')),submit=form.querySelector('.pay-submit');
var progress=document.createElement('div');progress.className='connect-progress';progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Onboarding progress');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax',String(groups.length));
var bar=document.createElement('div');progress.append(bar);form.before(progress);
var controls=document.createElement('div');controls.className='connect-actions';
var back=document.createElement('button');back.type='button';back.className='connect-back';back.textContent='Back';
var next=document.createElement('button');next.type='button';next.className='connect-next';next.textContent='Continue';
controls.append(back,next);form.append(controls);
var checked=JSON.parse(root.getAttribute('data-checked-fields')||'[]');
groups.forEach(function(group){group.querySelectorAll('input,select').forEach(function(input){input.required=true;if(input.type==='checkbox')input.checked=checked.includes(input.name);if(input.name==='ssn_last_4'){input.pattern='[0-9]{4}';input.inputMode='numeric';input.maxLength=4;}});});
var index=0;
function show(i){index=i;groups.forEach(function(group,n){group.hidden=n!==i;});items.forEach(function(item,n){if(n===i)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');item.classList.toggle('is-complete',n<i);});back.hidden=i===0;next.hidden=i===groups.length-1;submit.hidden=i!==groups.length-1;bar.style.width=((i+1)/groups.length*100)+'%';progress.setAttribute('aria-valuenow',String(i+1));progress.setAttribute('aria-valuetext',groups[i].querySelector('legend').textContent);root.classList.add('connect-ready');}
function invalid(group){return Array.from(group.querySelectorAll('input,select')).find(function(input){return !input.checkValidity();});}
back.addEventListener('click',function(){show(index-1);});
next.addEventListener('click',function(){var field=invalid(groups[index]);if(field){field.reportValidity();return;}show(index+1);groups[index].querySelector('input,select')?.focus();});
form.noValidate=true;
form.addEventListener('submit',function(event){for(var i=0;i<groups.length;i++){var field=invalid(groups[i]);if(field){event.preventDefault();show(i);field.reportValidity();return;}}});
if(form.querySelector('.pay-error')){var first=groups.findIndex(function(group){return invalid(group);});show(first<0?groups.length-1:first);}else show(0);
})();`;

function ConnectOnboarding(props: PaymentProps & { account: string; checked: string[] }) {
  return <div className="connect-onboarding" data-checked-fields={JSON.stringify(props.checked)}>
    <Payment {...props} />
    <div className="connect-context"><strong>Test mode</strong>{props.account}</div>
    <script dangerouslySetInnerHTML={{ __html: STEPS }} />
  </div>;
}
