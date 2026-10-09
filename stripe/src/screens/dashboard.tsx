// THE DASHBOARD — dashboard.stripe.com's pages an operator sets what Stripe's API cannot (docs/contributing/architecture.md,
// "Screens": a workspace): Customers, Public details, Radar lists and test Issuing funding.
// Customer inspection reads the same stored resources as the SDK. Other pages answer Stripe's 404.
//
// THE DASHBOARD'S PUBLIC DETAILS — a workspace page (docs/contributing/architecture.md, "Screens") of the Dashboard
// (manifest screen `dashboard`), at dashboard.stripe.com/settings/public: Settings → Business → Public details, where
// the operator sets what their customers see ("Public Details → Business Settings",
// support.stripe.com/questions/update-account-name-shown-in-the-dashboard). Its business name is the account's
// `business_profile.name`, "The customer-facing business name" (docs.stripe.com/api/accounts/object), and it is the
// name Checkout shows: "You can change a Checkout page's name by modifying the Business name field"
// (docs.stripe.com/payments/checkout/customization/appearance). Stripe's API has no call that changes the platform's
// own account (POST /v1/accounts/{account} updates a connected one), so this page is the only way to the act, and
// saving it writes the platform account's stored record (../engine/connect.ts), which GET /v1/account,
// Checkout and the customer portal then read. The Dashboard's account name (`settings.dashboard.display_name`,
// Settings → Account) is a separate, internal setting, "for internal use only" (the same support article), and this
// page does not touch it. Authored from plain markup under Stripe's type; nothing of Stripe's page is copied.
//
// Where the documentation stops and the twin decides: the page holds the business name only (the real page's
// support details, website and statement descriptor are not modelled here); the name is required and at most 5000
// characters (the spec's bound on business_profile.name), which the browser holds the field to and the page checks
// again for a client that is not a browser; no sign-in guards the page. The form posts to the page's own address
// and the save redirects to its own path. Saving is an update of an account that exists (the first save included, though
// the twin stores the platform's record only then), so every save is sent as account.updated.
//
import type { HandlerContext } from '@volter/world-core';
import { flowPage } from '@volter/world-ui';
import { VL } from '../engine/radar.ts';
import { nowUnix } from '../engine/stripe.ts';
import type { Row } from '../engine/common.ts';
import { platformAccountDefault } from '../engine/connect.ts';
import { publicBusinessName } from '../engine/display.ts';
import { PLATFORM_ACCOUNT_ID } from '../engine/stripe.ts';
import { formOf, money, notFound } from './shared.tsx';
import { created } from '../semantics/shared.ts';
const redirect = (path: string): Response => new Response(null, { status: 303, headers: { location: path } });
const invalid = (message: string): Response => flowPage({ css: [], title: 'Stripe', status: 400, body: <main><p role="alert">{message}</p></main> });

const PUBLIC_DETAILS_PATH = '/settings/public';
const MAX_NAME = 5000;

const DETAILS_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #ffffff; color: #1a1f36; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif; font-size: 14px; line-height: 1.5; }
button,input,select { font: inherit; }
button,a,input,select { outline-offset: 3px; }
button { cursor: pointer; }
button:disabled { cursor: default; color: #697386; }
a { color: #635bff; text-decoration: none; }
.sd { min-height: 100vh; display: grid; grid-template-columns: 224px minmax(0,1fr); }
.sd-side { background: #f6f8fa; border-right: 1px solid #e3e8ee; padding: 20px 14px; }
.sd-account { font-weight: 600; padding: 6px 10px 20px; overflow-wrap: anywhere; }
.sd-mode { display: block; width: fit-content; font-size: 11px; font-weight: 500; background: #e3e8ee; border-radius: 4px; margin-top: 8px; padding: 2px 7px; }
.sd-nav { display: grid; gap: 3px; }
.sd-nav a,.sd-nav button { display: block; text-align: left; padding: 7px 10px; font: inherit; border: 0; border-radius: 6px; background: none; color: #697386; }
.sd-nav a { color: #1a1f36; }
.sd-nav a:hover { background: #e3e8ee; }
.sd-nav [aria-current=page] { color: #635bff; background: #ffffff; font-weight: 600; }
.sd-nav-title { margin: 23px 10px 7px; font-size: 12px; font-weight: 600; color: #697386; }
.sd-body { min-width: 0; }
.sd-top { min-height: 64px; border-bottom: 1px solid #e3e8ee; padding: 14px 32px; display: flex; align-items: center; gap: 16px; }
.sd-search { width: min(520px,100%); border: 1px solid #e3e8ee; border-radius: 7px; padding: 7px 12px; background: #f6f8fa; }
.sd-top a { margin-left: auto; }
.sd-top button { border: 0; background: none; }
.sd-content { padding: 28px 40px 60px; max-width: 1280px; }
.sd-crumbs { color: #697386; font-size: 13px; display: flex; gap: 10px; margin-bottom: 18px; }
.sd-title { display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid #e3e8ee; padding-bottom: 20px; margin-bottom: 28px; }
.sd-title h1 { font-size: 28px; margin: 0; letter-spacing: -.5px; }
.pd { max-width: 860px; }
.pd h1 { font-size: 28px; margin: 16px 0 4px; }
.pd-lead { color: #697386; margin: 0 0 24px; }
.pd-card { background: #ffffff; border: 1px solid #e3e8ee; border-radius: 8px; padding: 24px; }
.pd-card label { display: block; font-weight: 600; margin-bottom: 6px; }
.pd-card small { display: block; color: #697386; margin-bottom: 8px; }
.pd-card input { width: 100%; padding: 8px 10px; border: 1px solid #c1c9d2; border-radius: 6px; font: inherit; }
.pd-actions { margin-top: 20px; display: flex; justify-content: flex-end; }
.sd-primary,.pd-actions button { background: #635bff; color: #ffffff; border: 0; border-radius: 6px; padding: 8px 16px; font: inherit; font-weight: 600; cursor: pointer; }
.pd-notice { padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; }
.pd-error { background: #fff0f3; color: #df1b41; }
.pd-saved { background: #e7f8ef; color: #0e6245; }
.sd-table { border-collapse: collapse; width: 100%; }
.sd-table th,.sd-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #e3e8ee; }
.sd-table th { font-size: 12px; font-weight: 600; color: #697386; background: #f6f8fa; }
.sd-empty { color: #697386; padding: 40px; text-align: center; }
.sd-code { font-family: ui-monospace,SFMono-Regular,monospace; font-size: 12px; }
.sd-customer-grid { display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 32px; align-items: start; }
.sd-customer-grid > * { min-width: 0; }
.sd-module { border-bottom: 1px solid #e3e8ee; padding: 0 0 24px; margin-bottom: 24px; overflow-x: auto; }
.sd-module h2 { font-size: 18px; margin: 0 0 16px; }
.sd-customer-details { border-left: 1px solid #e3e8ee; padding-left: 24px; overflow-wrap: anywhere; }
.sd-customer-details dl { margin: 0; }
.sd-customer-details dt { color: #697386; font-size: 12px; margin-top: 16px; }
.sd-customer-details dd { margin: 3px 0 0; }
.sd-customer-filter { display: flex; gap: 8px; margin-bottom: 20px; }
.sd-customer-filter input { min-width: 0; width: 320px; border: 1px solid #c1c9d2; border-radius: 6px; padding: 8px 10px; }
.sd-customer-tabs { display: flex; border-bottom: 1px solid #e3e8ee; margin-bottom: 28px; }
.sd-customer-tabs span { border-bottom: 2px solid #635bff; padding: 0 0 12px; color: #635bff; font-weight: 600; }
@media(max-width:1000px) { .sd-customer-grid { grid-template-columns: minmax(0,1fr); } .sd-customer-details { border-left: 0; padding: 0; } }
.sd-dialog { width: min(480px,calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid #e3e8ee; border-radius: 8px; padding: 24px; color: #1a1f36; }
.sd-dialog::backdrop { background: rgba(26,31,54,.4); }
.sd-dialog h2 { font-size: 20px; margin: 0 0 20px; }
.sd-dialog label { display: block; font-weight: 600; margin: 14px 0; }
.sd-dialog input,.sd-dialog select { display: block; width: 100%; margin-top: 6px; border: 1px solid #c1c9d2; border-radius: 6px; padding: 8px 10px; background: #ffffff; }
.sd-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.sd-cancel { border: 1px solid #c1c9d2; border-radius: 6px; padding: 8px 16px; background: #ffffff; color: #1a1f36; }
@media(max-width:760px) { .sd { grid-template-columns: 160px minmax(0,1fr); } .sd-content { padding: 24px 20px; } .sd-top { padding: 14px 20px; } .sd-top button { display: none; } .sd-table { font-size: 12px; } }
@media(max-width:520px) { .sd { display: block; } .sd-side { border-right: 0; border-bottom: 1px solid #e3e8ee; padding: 10px 16px; } .sd-account { padding: 0 0 8px; } .sd-mode { display: inline; margin-left: 8px; } .sd-nav { display: flex; flex-wrap: wrap; } .sd-nav button,.sd-nav-title { display: none; } .sd-content { padding: 20px 16px; } .sd-title h1 { font-size: 24px; } .sd-top { padding: 12px 16px; } }
`;

type DashboardPage = { title: string; section: string; path: string; body: Parameters<typeof flowPage>[0]['body']; action?: Parameters<typeof flowPage>[0]['body']; status?: number };
/** The documented dashboard navigation around only the operator pages this pack already serves. */
function dashboardPage(ctx: HandlerContext, opts: DashboardPage): Response {
  const account = ctx.get('account', PLATFORM_ACCOUNT_ID);
  const links = [['Public details', PUBLIC_DETAILS_PATH], ['Radar lists', '/radar/lists'], ['Issuing balance', '/test/issuing/balance']];
  return flowPage({ title: `${opts.title} – Stripe`, css: [DETAILS_CSS], status: opts.status ?? 200, body: <div className="sd">
    <aside className="sd-side"><div className="sd-account">{publicBusinessName(account)}<span className="sd-mode">Test mode</span></div><nav className="sd-nav" aria-label="Dashboard">
      {['Home', 'Balances', 'Transactions', 'Customers', 'Product catalog'].map(label => label === 'Customers'
        ? <a key={label} href={`${ctx.publicBase}/customers`} aria-current={opts.path === '/customers' ? 'page' : undefined}>Customers</a>
        : <button key={label} type="button" disabled title="Not available in this twin's Dashboard">{label}</button>)}
      <p className="sd-nav-title">Shortcuts</p>{links.map(([label,path]) => <a key={path} href={`${ctx.publicBase}${path}`} aria-current={opts.path === path ? 'page' : undefined}>{label}</a>)}
      <p className="sd-nav-title">Products</p>{['Payments', 'Billing', 'Reporting', 'Connect', 'More'].map(label => <button key={label} type="button" disabled title="Not available in this twin's Dashboard">{label}</button>)}
    </nav></aside><div className="sd-body"><header className="sd-top"><input className="sd-search" aria-label="Search Dashboard" placeholder="Search" disabled title="Dashboard search is not available in this twin"/><button type="button" disabled title="Not available in this twin's Dashboard">Create</button><button type="button" disabled>Help</button><a href={`${ctx.publicBase}${PUBLIC_DETAILS_PATH}`}>Settings</a></header>
    <main className="sd-content"><nav className="sd-crumbs" aria-label="Breadcrumb"><span>{opts.section}</span><span aria-hidden="true">/</span><span>{opts.title}</span></nav><div className="sd-title"><h1>{opts.title}</h1>{opts.action}</div>{opts.body}</main></div>
    <script dangerouslySetInnerHTML={{ __html: "document.querySelectorAll('[data-open-dialog]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.openDialog).showModal()));document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));" }}/>
  </div> });
}

const customerName = (row: Row): string => String(row.name || row.email || row.id);
const resourceId = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' ? String((value as Row).id ?? '') : '';
const newest = (rows: Row[]): Row[] => rows.slice().reverse().sort((a,b) => Number(b.created ?? 0) - Number(a.created ?? 0));
const customerDate = (value: unknown): string => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value * 1000)) : '—';

// source: https://support.stripe.com/questions/export-customer-data-without-the-payment-details
// source: https://support.stripe.com/questions/updates-to-the-customer-detail-page
// These public support articles render their body in JavaScript; the source reader gets their shell.
// Their public rendered body supplies Customers and the dynamic-left/static-right layout (spec/SOURCE.md).
// Where public references stop: q is an authored name/email/id/description substring filter, not Stripe's
// private Dashboard search wire. Dates are shown in UTC; browser actions here are read-only. The declared
// page addresses preserve the customer's returned API id. There is no invented payment history or total.
function customersPage(ctx: HandlerContext, path: string): Response {
  if (ctx.call.request.method !== 'GET') return notFound();
  if (path === '/customers') {
    const query = new URL(ctx.call.request.url).searchParams.get('q') ?? '';
    const needle = query.trim().toLowerCase();
    const customers = newest(ctx.rows('customer')).filter(row => !needle ||
      [row.name, row.email, row.id, row.description].some(value => typeof value === 'string' && value.toLowerCase().includes(needle)));
    return dashboardPage(ctx, { title: 'Customers', section: 'Customers', path: '/customers',
      body: <><form className="sd-customer-filter" method="get" action={`${ctx.publicBase}/customers`}>
        <input name="q" aria-label="Search customers" placeholder="Search customers" defaultValue={query}/><button className="sd-cancel" type="submit">Search</button>
        {query ? <a href={`${ctx.publicBase}/customers`}>Clear</a> : null}
      </form><table className="sd-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Description</th><th scope="col">Created (UTC)</th></tr></thead>
        <tbody>{customers.map(row => <tr key={String(row.id)}><td><a href={`${ctx.publicBase}/customers/${encodeURIComponent(String(row.id))}`}>{customerName(row)}</a></td><td>{String(row.email ?? '—')}</td><td>{String(row.description ?? '—')}</td><td>{customerDate(row.created)}</td></tr>)}</tbody></table>
        {!customers.length ? <p className="sd-empty">{needle ? 'No customers match your search.' : 'No customers yet.'}</p> : null}</> });
  }
  let id: string;
  try { id = decodeURIComponent(path.slice('/customers/'.length)); } catch { return notFound(); }
  const customer = ctx.get('customer', id);
  if (!customer || customer.deleted === true) return notFound();
  const related = (type: string): Row[] => newest(ctx.rows(type)).filter(row => resourceId(row.customer) === id);
  const payments = related('charge'), subscriptions = related('subscription'), invoices = related('invoice'), methods = related('payment_method');
  const metadata = customer.metadata && typeof customer.metadata === 'object' ? Object.entries(customer.metadata as Row) : [];
  const address = customer.address && typeof customer.address === 'object' ? customer.address as Row : undefined;
  const addressText = address ? ['line1','line2','city','state','postal_code','country'].map(key => address[key]).filter(Boolean).join(', ') : '—';
  return dashboardPage(ctx, { title: customerName(customer), section: 'Customers', path: '/customers',
    body: <><a href={`${ctx.publicBase}/customers`}>← Customers</a><p className="pd-lead sd-code">{id}</p><div className="sd-customer-tabs"><span>Overview</span></div>
      <div className="sd-customer-grid"><div>
        <section className="sd-module"><h2>Subscriptions</h2>{subscriptions.length ? <table className="sd-table"><thead><tr><th scope="col">Subscription</th><th scope="col">Status</th><th scope="col">Created (UTC)</th></tr></thead><tbody>{subscriptions.map(row => <tr key={String(row.id)}><td className="sd-code">{String(row.id)}</td><td>{String(row.status ?? '—')}</td><td>{customerDate(row.created)}</td></tr>)}</tbody></table> : <p className="pd-lead">No subscriptions</p>}</section>
        <section className="sd-module"><h2>Payments</h2>{payments.length ? <table className="sd-table"><thead><tr><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Description</th><th scope="col">Created (UTC)</th></tr></thead><tbody>{payments.map(row => <tr key={String(row.id)}><td>{money(row.amount, row.currency)}</td><td>{row.refunded === true ? 'Refunded' : String(row.status ?? '—')}</td><td>{String(row.description ?? row.id)}</td><td>{customerDate(row.created)}</td></tr>)}</tbody></table> : <p className="pd-lead">No payments</p>}</section>
        <section className="sd-module"><h2>Payment methods</h2>{methods.length ? <ul>{methods.map(row => { const card = row.card && typeof row.card === 'object' ? row.card as Row : undefined; return <li key={String(row.id)}>{card ? `${String(card.brand ?? 'Card')} •••• ${String(card.last4 ?? '')}` : String(row.type ?? 'Payment method')} <span className="sd-code">{String(row.id)}</span></li>; })}</ul> : <p className="pd-lead">No payment methods</p>}</section>
        <section className="sd-module"><h2>Invoices</h2>{invoices.length ? <table className="sd-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Amount due</th><th scope="col">Status</th></tr></thead><tbody>{invoices.map(row => <tr key={String(row.id)}><td>{String(row.number ?? row.id)}</td><td>{money(row.amount_due, row.currency)}</td><td>{String(row.status ?? '—')}</td></tr>)}</tbody></table> : <p className="pd-lead">No invoices</p>}</section>
      </div><aside className="sd-customer-details" aria-label="Customer details">
        <section className="sd-module"><h2>Details</h2><dl><dt>Customer ID</dt><dd className="sd-code">{id}</dd><dt>Name</dt><dd>{String(customer.name ?? '—')}</dd><dt>Email</dt><dd>{String(customer.email ?? '—')}</dd><dt>Phone</dt><dd>{String(customer.phone ?? '—')}</dd><dt>Description</dt><dd>{String(customer.description ?? '—')}</dd><dt>Billing address</dt><dd>{addressText}</dd><dt>Created (UTC)</dt><dd>{customerDate(customer.created)}</dd></dl></section>
        <section className="sd-module"><h2>Metadata</h2>{metadata.length ? <dl>{metadata.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl> : <p className="pd-lead">No metadata</p>}</section>
      </aside></div></> });
}

function detailsPage(ctx: HandlerContext, account: Row | undefined, opts: { value?: string; error?: string; saved?: boolean } = {}): Response {
  const named = (account?.business_profile as Row | undefined)?.name;
  const value = opts.value ?? (typeof named === 'string' ? named : '');
  return dashboardPage(ctx, {
    title: 'Public details', section: 'Settings / Business', path: PUBLIC_DETAILS_PATH,
    ...(opts.error ? { status: 400 } : {}),
    body: (
      <div className="pd">
        <p className="pd-lead">What your customers see on Checkout, the customer portal, receipts and invoices. Currently shown: <strong data-testid="public-business-name">{publicBusinessName(account)}</strong></p>
        {opts.error ? <p className="pd-notice pd-error" role="alert">{opts.error}</p> : null}
        {opts.saved ? <p className="pd-notice pd-saved" role="status">Your public details were saved.</p> : null}
        <form className="pd-card" method="post">
          <label htmlFor="business_name">Business name</label>
          <small>The name customers see when they pay you.</small>
          <input id="business_name" name="business_name" autoComplete="organization" defaultValue={value} required maxLength={MAX_NAME} />
          <div className="pd-actions"><button type="submit">Save</button></div>
        </form>
      </div>
    ),
  });
}

/** Save the business name on the platform's own account: the stored record, made from Stripe's default the first
 *  time anything is saved, and otherwise changed in place (its other public details kept). */
async function save(ctx: HandlerContext, name: string): Promise<void> {
  const held = ctx.get('account', PLATFORM_ACCOUNT_ID);
  const profile = { business_profile: { ...(((held ?? platformAccountDefault()).business_profile as Row | undefined) ?? {}), name } };
  await (held ? ctx.write('account', PLATFORM_ACCOUNT_ID, profile, 'account.update') : created(ctx, 'account', { ...platformAccountDefault(), ...profile }, {}, { operation: 'account.update' }));
}

/** What the page says of a name no browser sends (the field is required and bounded), for a client that sends it. */
function nameRefused(name: string): string | undefined {
  return !name ? 'Enter your business name.' : name.length > MAX_NAME ? `Your business name must be at most ${MAX_NAME} characters.` : undefined;
}

async function publicDetails(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'POST') return notFound();
  const form = request.method === 'POST' ? await formOf(request.clone()) : {};
  if (request.method === 'GET') return detailsPage(ctx, ctx.get('account', PLATFORM_ACCOUNT_ID), { saved: url.searchParams.has('saved') });
  const name = (form.business_name ?? '').trim();
  const refused = nameRefused(name);
  if (refused) return detailsPage(ctx, ctx.get('account', PLATFORM_ACCOUNT_ID), { value: form.business_name ?? '', error: refused });
  await save(ctx, name);
  // a query-only reference: the page's own path, wherever it is mounted and with or without its trailing slash
  return new Response(null, { status: 303, headers: { location: '?saved=1' } });
}

/** Dashboard customer inspection, settings, Radar lists and test Issuing funding. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  // The declared workspace opens a served setting, not a fabricated analytics home.
  if (!path && ctx.call.request.method === 'GET') return redirect(`${ctx.publicBase}${PUBLIC_DETAILS_PATH}`);
  if (path === '/customers' || /^\/customers\/[^/]+$/.test(path)) return customersPage(ctx, path);
  // source: https://docs.stripe.com/radar/lists "Use the Dashboard or the API to create lists."
  // source: https://docs.stripe.com/radar/lists "Enter a name for the list"
  // source: https://docs.stripe.com/radar/lists "Select the type of list to create."
  // source: https://docs.stripe.com/radar/lists "Click Add to save your new list."
  // Where the documentation stops: it names Dashboard controls, not their browser request routes or form wire.
  // This authored page uses /radar/lists for GET and POST, /radar/lists/{id} for its redirect/detail address,
  // and a 303 redirect after saving. The HTML field names name, alias and item_type are the twin's choices;
  // item_type values are the pinned API's enums, not published Dashboard form values. The alias fallback's
  // lowercase/underscore algorithm is also authored; Stripe says it generates an alias but gives no algorithm.
  if (/^\/radar\/lists(?:\/[^/]+)?$/.test(path)) {
    if (ctx.call.request.method === 'POST') {
      const form = await formOf(ctx.call.request);
      const types = ['string', 'case_sensitive_string', 'card_fingerprint', 'card_bin', 'customer_id', 'email', 'ip_address', 'country', 'sepa_debit_fingerprint', 'us_bank_account_fingerprint'];
      if (!form.name?.trim() || !types.includes(form.item_type ?? '')) return invalid('Enter a name and select a list type.');
      const alias = form.alias?.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      // Where the page stops: an operator has no login identity in the World; created_by is its synthetic operator.
      const list = await created(ctx, VL, { name: form.name.trim(), alias, item_type: form.item_type }, {
        created_by: 'twin', livemode: false, metadata: {},
        list_items: { object: 'list', data: [], has_more: false, url: '/v1/radar/value_list_items' },
      });
      await ctx.write(VL, String(list.id), { list_items: { object: 'list', data: [], has_more: false, url: `/v1/radar/value_list_items?value_list=${list.id}` } }, 'radar.value_list.updated');
      return redirect(`${ctx.publicBase}/radar/lists/${list.id}`);
    }
    const lists = ctx.rows(VL);
    const types = [['customer_id', 'Customer ID'], ['email', 'Email'], ['card_fingerprint', 'Card fingerprint'], ['card_bin', 'Card BIN'], ['ip_address', 'IP address'], ['string', 'String'], ['case_sensitive_string', 'Case-sensitive string'], ['country', 'Country'], ['sepa_debit_fingerprint', 'SEPA Direct Debit fingerprint'], ['us_bank_account_fingerprint', 'ACH Direct Debit fingerprint']];
    const selected = lists.find(row => path === `/radar/lists/${row.id}`);
    return dashboardPage(ctx, { title: selected ? String(selected.name) : 'Lists', section: 'Payments / Radar', path: '/radar/lists',
      action: <button className="sd-primary" type="button" data-open-dialog="radar-new-list">New list</button>,
      body: <>{selected ? <div className="pd-card"><a href={`${ctx.publicBase}/radar/lists`}>All lists</a><h2>{String(selected.name)}</h2><p>Alias: <code>{String(selected.alias)}</code></p><p>List type: {types.find(([key]) => key === selected.item_type)?.[1] ?? String(selected.item_type)}</p></div> : null}<p className="pd-lead">Lists of information to block, allow or review matching payments.</p>
        <table className="sd-table"><thead><tr><th scope="col">Name</th><th scope="col">Alias</th><th scope="col">List type</th></tr></thead><tbody>{lists.map(row => <tr key={String(row.id)}><td><a href={`${ctx.publicBase}/radar/lists/${encodeURIComponent(String(row.id))}`}>{String(row.name)}</a></td><td className="sd-code">{String(row.alias)}</td><td>{types.find(([key]) => key === row.item_type)?.[1] ?? String(row.item_type)}</td></tr>)}</tbody></table>
        {!lists.length ? <p className="sd-empty">No lists yet. Create a list to group related values.</p> : null}
        <dialog className="sd-dialog" id="radar-new-list" aria-labelledby="radar-new-list-title"><h2 id="radar-new-list-title">New list</h2><form method="post" action={`${ctx.publicBase}/radar/lists`}>
          <label htmlFor="radar-list-name">Name</label><input id="radar-list-name" name="name" required/>
          <label htmlFor="radar-list-alias">Alias</label><input id="radar-list-alias" name="alias"/><p className="pd-lead">Leave blank to generate an alias from the name.</p>
          <label htmlFor="radar-list-type">List type</label><select id="radar-list-type" name="item_type">{types.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="sd-dialog-actions"><button className="sd-cancel" type="button" data-close-dialog>Cancel</button><button className="sd-primary" type="submit">Add</button></div>
        </form></dialog></> });
  }
  // source: https://docs.stripe.com/issuing/testing "Before you create test transactions, you must add test funds to the Issuing balance on your account."
  // source: https://docs.stripe.com/issuing/testing "You can create test top-ups in the Dashboard, or with the Top-ups API"
  // Where the documentation stops: it states the Dashboard funding act, not a browser request path or form wire.
  // The authored GET/POST address and 303 redirect are /test/issuing/balance. The form name amount, its positive
  // integer validation and its units (USD cents for this US sandbox) are the twin's choices, not published form
  // fields. Its POST records the balance change in the vendor ledger, with source=null (permitted by the pinned
  // schema) and immediate availability for this sandbox control; the page states neither that source nor timing.
  // No private Topup object is seeded or answered, and the uncalled Top-ups API remains the gap.
  if (path === '/test/issuing/balance') {
    if (ctx.call.request.method === 'POST') {
      const form = await formOf(ctx.call.request);
      const amount = Number(form.amount);
      if (!Number.isInteger(amount) || amount <= 0) return invalid('Enter a positive amount in cents.');
      await created(ctx, 'balance_transaction', {}, { amount, currency: 'usd', fee: 0, net: amount, type: 'topup', reporting_category: 'topup', source: null, status: 'available', balance_type: 'issuing', available_on: Number(nowUnix(ctx.occurredAt)), fee_details: [] });
      return redirect(`${ctx.publicBase}/test/issuing/balance?funded=1`);
    }
    return dashboardPage(ctx, { title: 'Issuing balance', section: 'Issuing', path: '/test/issuing/balance', body: <div className="pd"><p className="pd-lead">Add test funds before creating test Issuing transactions.</p>{new URL(ctx.call.request.url).searchParams.has('funded') ? <p className="pd-notice pd-saved" role="status">Test funds were added to your Issuing balance.</p> : null}<form className="pd-card" method="post" action={`${ctx.publicBase}/test/issuing/balance`}><label htmlFor="issuing-amount">Amount</label><small>USD cents. These funds belong to this test account.</small><input id="issuing-amount" name="amount" type="number" min="1" step="1" required/><div className="pd-actions"><button type="submit">Add test funds</button></div></form></div> });
  }
  return path === PUBLIC_DETAILS_PATH ? publicDetails(ctx) : notFound();
}
