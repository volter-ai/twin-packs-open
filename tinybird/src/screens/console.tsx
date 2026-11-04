// TINYBIRD'S CONSOLE DOORS — sign-up and sign-in, the Organization, a Workspace's creation, its Tokens page and the
// Organization's Billing (docs/contributing/architecture.md, "Screens"), at cloud.tinybird.co, the host the Classic CLI
// sends a person to for a region (`https://api.tinybird.co` → `https://cloud.tinybird.co/gcp/europe-west3`,
// tinybird-cli's config.py). The API's first token can only be read on a page: every Workspace "is created with a set
// of basic Tokens", viewed "in the "Tokens" section in your Tinybird workspace"
// (https://www.tinybird.co/docs/classic/administration/auth-tokens), and a page asks who is signed in first.
//
// THE PAGES, each from Tinybird's words:
// - /signup: "Create a Tinybird account" (https://www.tinybird.co/docs/classic/get-started/quick-start, which links
//   https://cloud.tinybird.co/signup), with an email and a password. /login for a person coming back: the email and
//   password, then the one-time code MFA emails ("Multi-Factor Authentication (MFA) will be enabled by default for users
//   signing in with email and password starting September 8, 2025. When you log in, you'll be asked to enter a one-time
//   code sent to your email address", https://www.tinybird.co/docs/changelog/2025-09-05-september-week-one).
// - /organizations/new: "Workspaces are always created inside Organizations … If you don't have an Organization
//   defined, you can also create one in Tinybird Cloud" (https://www.tinybird.co/docs/classic/administration/workspaces);
//   "Each organization is tied to a single region" (https://www.tinybird.co/docs/classic/pricing/developer). It starts on
//   the Free plan (https://www.tinybird.co/docs/classic/pricing/free).
// - /workspaces/new: "Select Create Workspace" (Workspaces page), with the choice "between Classic and Forward. New
//   signups will be created in Tinybird Forward by default" (changelog, 2025-03-14). This World serves Classic's API, so
//   choosing Forward answers that it does not.
// - /<provider>/<region>/<workspace>/tokens: the Workspace's Tokens section, each token with its scopes and value, and
//   the person's user token (../semantics/shared.ts `createTinybirdWorkspace` makes the default ones).
// - /organizations/<id>/billing: billing details (a card), then Upgrade to a Developer size: "Select Upgrade. Select your
//   vCPU size and fill out the details" (Free plan page), "After adding billing details, you can select and resize any
//   Developer plan up to 8 vCPUs" (Developer plan page; sizes S-1/4 to S-8); and "Select the More actions (⋯) button and
//   then select Cancel plan. Review the information and confirm. Remaining costs are charged automatically upon
//   cancellation" (Developer plan page, Downgrade), charged to the card on file.
//
// Where Tinybird's documentation stops and the twin decides: sign-up asks no code (the changelog speaks of MFA at log-in);
// the code arrives in the World's stand-in for the person's inbox (`GET /_twin/mailbox/{email}`, semantics/doors.ts) and is good
// for 10 minutes and once; a password needs 8 characters; a card is checked for its Luhn digit and expiry only; the
// session cookie is named `tinybird_twin_session`; a session does not end; a final invoice is recorded with no amount,
// since the twin models no prices. Built from @volter/world-ui's pieces under Tinybird's skin; nothing of Tinybird's page is copied.
import { digest, personOf, personWith, recordPerson, type HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, redirect, SignIn, SignInCode, SIGN_IN_CSS, signedIn, startSession, toSignIn } from '@volter/world-ui';
import { createTinybirdOrganization, createTinybirdWorkspace, storeOf, TINYBIRD_REGIONS, tinybirdUserToken, tinybirdWorkspaces, tinybirdWorkspaceTokens } from '../semantics/shared.ts';

const COOKIE = 'tinybird_twin_session';
const CODE_TTL_MS = 10 * 60_000;

const PLANS = [
  { value: 'free', label: 'Free' },
  ...['S-1/4', 'S-1/2', 'S-1', 'S-2', 'S-4', 'S-8'].map((size) => ({ value: `developer:${size}`, label: `Developer ${size}` })),
];

const SKIN = `
body { background: #ffffff; color: #25283d; }
.sign-in-mark { background: #27f795; border-radius: 6px; }
.sign-in-error { background: #fff4f2; border-color: #f4c7bf; color: #25283d; }
.sign-in-box { background: #ffffff; border-color: #e5e5e5; }
.sign-in-hint { color: #636679; }
.sign-in-submit { background: #0a0a0a; border-color: #0a0a0a; color: #ffffff; }
.portal-side { background: #f7f7f7; border-right: 1px solid #e5e5e5; }
.portal-notice { background: #effdf6; border: 1px solid #b7f3d6; font-family: ui-monospace, monospace; word-break: break-all; }
.portal-primary { background: #0a0a0a; border-color: #0a0a0a; color: #ffffff; }
`;

type Row = Record<string, unknown>;
const hex = (s: string): string => digest('sha256', s);
const rowsOf = (ctx: HandlerContext, type: string): Row[] => ctx.rowsRaw(type) as Row[];
const record = (ctx: HandlerContext, type: string, id: string, fields: Row): Promise<string> => ctx.record(type, fields, `${type}:${id}`);
const toLogin = (next: string): Response => toSignIn('/login', next);
const nextOf = (raw: string | null | undefined, fallback: string): string => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback);

// ── the World's state behind the pages: people, Organizations, invoices ─────────────────────

type Organization = { id: string; name: string; admin: string; region: string; plan: string; status: string; card?: string };
const organizations = (ctx: HandlerContext): Organization[] => rowsOf(ctx, '_organization').map((o) => ({
  id: String(o.orgId), name: String(o.name), admin: String(o.admin), region: String(o.region), plan: String(o.plan), status: String(o.status),
  ...(typeof o.card === 'string' ? { card: o.card } : {}),
}));

// ── pages ───────────────────────────────────────────────────────────────────────────────────

function passwordPage(kind: 'signup' | 'login', next: string, error?: string): Response {
  const signup = kind === 'signup';
  return flowPage({
    title: signup ? 'Sign up · Tinybird' : 'Log in · Tinybird',
    css: [SIGN_IN_CSS, SKIN],
    status: error ? 422 : 200,
    body: (
      <SignIn
        heading={signup ? 'Create your Tinybird account' : 'Log in to Tinybird'}
        action={signup ? '/signup' : '/login'}
        fields={{ next }}
        account={{ name: 'email', label: 'Email' }}
        password={{ name: 'password', label: 'Password' }}
        submit={signup ? 'Sign up' : 'Log in'}
        {...(error ? { error } : {})}
      />
    ),
  });
}

function codePage(email: string, next: string, error?: string): Response {
  return flowPage({
    title: 'Log in · Tinybird',
    css: [SIGN_IN_CSS, SKIN],
    status: error ? 422 : 200,
    body: (
      <SignInCode
        heading="Check your email"
        hint={`We sent a one-time code to ${email}.`}
        action="/login/verify"
        fields={{ email, next }}
        code={{ name: 'code', label: 'One-time code' }}
        submit="Continue"
        {...(error ? { error } : {})}
      />
    ),
  });
}


function portalPage(title: string, email: string, props: Omit<Parameters<typeof Portal>[0], 'merchant'>, status = 200): Response {
  return flowPage({ title: `${title} · Tinybird`, css: [PORTAL_CSS, SKIN], status, body: <Portal merchant={`${email} · Tinybird`} {...props} /> });
}

function organizationPage(email: string, notice?: string, status = 200): Response {
  return portalPage('New Organization', email, {
    ...(notice ? { notice } : {}),
    sections: [],
    forms: [{
      heading: 'Create Organization',
      action: '/organizations/new',
      fields: [
        { id: 'name', label: 'Organization name' },
        { id: 'region', label: 'Region', options: TINYBIRD_REGIONS.map((r) => ({ value: r.path, label: r.label })) },
      ],
      submit: { label: 'Create Organization' },
    }],
  }, status);
}


function workspaceFormPage(ctx: HandlerContext, email: string, notice?: string, status = 200): Response {
  const mine = organizations(ctx).filter((o) => o.admin === email);
  return portalPage('Create Workspace', email, {
    ...(notice ? { notice } : {}),
    sections: [],
    forms: [{
      heading: 'Create Workspace',
      action: '/workspaces/new',
      fields: [
        { id: 'name', label: 'Workspace name' },
        { id: 'organization', label: 'Organization', options: mine.map((o) => ({ value: o.id, label: o.name })) },
        // Forward first: "New signups will be created in Tinybird Forward by default"
        { id: 'version', label: 'Tinybird version', options: [{ value: 'forward', label: 'Tinybird Forward' }, { value: 'classic', label: 'Tinybird Classic' }] },
      ],
      submit: { label: 'Create Workspace' },
    }],
  }, status);
}

function tokensPage(ctx: HandlerContext, email: string, workspace: { id: string; name: string }): Response {
  const userToken = tinybirdUserToken(storeOf(ctx), email);
  return portalPage(`Tokens · ${workspace.name}`, email, {
    back: { href: '/workspaces/new', label: 'Workspaces' },
    sections: [{
      heading: `Tokens · ${workspace.name}`,
      empty: 'No tokens.',
      items: [
        ...tinybirdWorkspaceTokens(storeOf(ctx), workspace.id).map((t) => ({ title: t.name, detail: `Scopes: ${t.scopes.join(', ')}`, note: t.token })),
        ...(userToken ? [{ title: 'user token', detail: 'Your user token: create Workspaces, or delete ones where you are an admin', note: userToken }] : []),
      ],
    }],
  });
}

function billingPage(email: string, org: Organization, notice?: string, status = 200): Response {
  const developer = org.plan.startsWith('developer') && org.status !== 'canceled';
  const plan = developer ? PLANS.find((p) => p.value === org.plan)?.label ?? org.plan : 'Free';
  const base = `/organizations/${org.id}/billing`;
  return portalPage(`Billing · ${org.name}`, email, {
    back: { href: '/workspaces/new', label: 'Workspaces' },
    ...(notice ? { notice } : {}),
    sections: [{
      heading: 'Billing',
      items: [
        {
          title: plan,
          detail: org.status === 'canceled' ? 'Developer plan canceled; Free plan limits apply' : `Organization ${org.name} · ${org.region}`,
          ...(developer ? { actions: [{ label: 'Cancel plan', action: `${base}/cancel`, fields: { confirm: 'yes' }, tone: 'danger' as const }] } : {}),
        },
        { title: 'Billing details', detail: org.card ? `Card ending ${org.card}` : 'None added' },
      ],
    }],
    forms: [
      ...(org.card ? [] : [{
        heading: 'Add billing details',
        action: `${base}/details`,
        fields: [
          { id: 'cardholder', label: 'Cardholder name', autoComplete: 'cc-name' },
          { id: 'card_number', label: 'Card number', autoComplete: 'cc-number' },
          { id: 'expiry', label: 'Expiry (MM/YY)', autoComplete: 'cc-exp' },
          { id: 'cvc', label: 'CVC', autoComplete: 'cc-csc' },
          { id: 'country', label: 'Country' },
        ],
        submit: { label: 'Save billing details' },
      }]),
      ...(developer ? [] : [{
        heading: 'Upgrade',
        action: `${base}/upgrade`,
        fields: [{ id: 'plan', label: 'Plan size', options: PLANS.filter((p) => p.value !== 'free') }],
        submit: { label: 'Upgrade' },
      }]),
    ],
  }, status);
}

/** A card number as a card network takes it: 13 to 19 digits passing the Luhn check. */
function luhn(number: string): boolean {
  const digits = number.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The console's pages at cloud.tinybird.co; any other path on the host is the caller's 404. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  return (await pages(ctx)) ?? new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

async function pages(ctx: HandlerContext): Promise<Response | undefined> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const occurredAt = ctx.occurredAt;
  const now = Date.parse(occurredAt);

  // sign-up: an email and a password, and the person is signed in; log-in: the email and password, then the one-time
  // code MFA sends ("Multi-Factor Authentication (MFA) will be enabled by default for users signing in with email and
  // password starting September 8, 2025. When you log in, you'll be asked to enter a one-time code sent to your email
  // address", changelog 2025-09-05)
  const session = (email: string, next: string): Promise<Response> => startSession(ctx, email, COOKIE, next);
  if ((path === '/signup' || path === '/login') && request.method === 'GET') {
    return passwordPage(path === '/signup' ? 'signup' : 'login', nextOf(url.searchParams.get('next'), path === '/signup' ? '/organizations/new' : '/workspaces/new'));
  }
  if (path === '/signup' && request.method === 'POST') {
    const f = formOf(ctx);
    const email = (f.email ?? '').trim().toLowerCase();
    const next = nextOf(f.next, '/organizations/new');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return passwordPage('signup', next, 'Enter a valid email address.');
    if ((f.password ?? '').length < 8) return passwordPage('signup', next, 'Your password needs at least 8 characters.');
    if (personOf(ctx, email)) return passwordPage('signup', next, 'An account with this email already exists. Log in instead.');
    await recordPerson(ctx, email, f.password!, { created_at: occurredAt });
    return session(email, next);
  }
  if (path === '/login' && request.method === 'POST') {
    const f = formOf(ctx);
    const email = (f.email ?? '').trim().toLowerCase();
    const next = nextOf(f.next, '/workspaces/new');
    if (!personWith(ctx, email, f.password ?? '')) return passwordPage('login', next, 'Incorrect email or password.');
    const n = Number(await (async () => { const n = ctx.mint('_seq_login_code'); await ctx.record('_seq_login_code', {}, n); return n; })());
    // a one-time code is a credential: drawn from a secret the World holds, never computed from the email and time
    const code = String(parseInt(hex(await ctx.secret(`otp:${email}:${n}`)).slice(0, 8), 16) % 1_000_000).padStart(6, '0');
    await record(ctx, '_login_code', `${email}:${n}`, { email, code_sha256: hex(code), expires_at: now + CODE_TTL_MS, used: false });
    await record(ctx, '_mail', `${email}:${n}`, { from: 'Tinybird <noreply@tinybird.co>', to: email, subject: 'Your Tinybird login code', text: `Your one-time code is ${code}. It expires in 10 minutes.`, at: now });
    return codePage(email, next);
  }
  if (path === '/login/verify' && request.method === 'POST') {
    const f = formOf(ctx);
    const email = (f.email ?? '').trim().toLowerCase();
    const next = nextOf(f.next, '/workspaces/new');
    const code = rowsOf(ctx, '_login_code').find((c) => c.email === email && c.used !== true && Number(c.expires_at) > now && c.code_sha256 === hex((f.code ?? '').trim()));
    if (!code) return codePage(email, next, 'The code is not valid. Check it, or log in again for a new one.');
    await ctx.record('_login_code', { ...ctx.own(code), used: true }, String(code.id));
    return session(email, next);
  }

  const email = signedIn(ctx, COOKIE)?.email;

  if (path === '/organizations/new') {
    if (!email) return toLogin(path);
    if (request.method === 'GET') return organizationPage(email);
    if (request.method !== 'POST') return undefined;
    const f = formOf(ctx);
    const name = (f.name ?? '').trim();
    if (!name) return organizationPage(email, 'An Organization needs a name.', 422);
    if (!TINYBIRD_REGIONS.some((r) => r.path === f.region)) return organizationPage(email, 'Choose a region.', 422);
    // an Organization starts on the Free plan; a Developer plan is chosen on Billing once billing details are added
    await createTinybirdOrganization(ctx, { name, admin: email, region: f.region! });
    return redirect('/workspaces/new');
  }

  if (path === '/workspaces/new') {
    if (!email) return toLogin(path);
    if (request.method === 'GET') return workspaceFormPage(ctx, email);
    if (request.method !== 'POST') return undefined;
    const f = formOf(ctx);
    const name = (f.name ?? '').trim();
    const org = organizations(ctx).find((o) => o.id === f.organization && o.admin === email);
    if (!org) return workspaceFormPage(ctx, email, 'Choose an Organization you administer.', 422);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return workspaceFormPage(ctx, email, 'A Workspace name starts with a letter and holds letters, digits and underscores.', 422);
    if (tinybirdWorkspaces(storeOf(ctx)).some((w) => w.name === name)) return workspaceFormPage(ctx, email, `A Workspace named ${name} already exists.`, 422);
    if (f.version !== 'classic') return workspaceFormPage(ctx, email, 'This World serves the Tinybird Classic API only: choose Tinybird Classic.', 422);
    const made = await createTinybirdWorkspace(ctx, { name, organizationId: org.id, owner: email, salt: await ctx.secret('tinybird-token-salt') });
    if (made instanceof Response) return workspaceFormPage(ctx, email, `A Workspace named ${name} already exists.`, 422);
    return redirect(`/${org.region}/${name}/tokens`);
  }

  const tokens = /^\/(gcp|aws)\/([a-z0-9-]+)\/([^/]+)\/tokens$/.exec(path);
  if (tokens && request.method === 'GET') {
    if (!email) return toLogin(path);
    const region = `${tokens[1]}/${tokens[2]}`;
    const w = tinybirdWorkspaces(storeOf(ctx)).find((x) => x.name === decodeURIComponent(tokens[3]!) && x.owner === email
      && organizations(ctx).find((o) => o.id === x.organizationId)?.region === region);
    if (!w) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return tokensPage(ctx, email, w);
  }

  // "Go to Organization settings → Billing. Select Upgrade. Select your vCPU size and fill out the details" (Free plan
  // page); "After adding billing details, you can select and resize any Developer plan" (Developer plan page); "Select
  // the More actions (⋯) button and then select Cancel plan … Remaining costs are charged automatically upon
  // cancellation" (Developer plan page, Downgrade)
  const billing = /^\/organizations\/([^/]+)\/billing(?:\/(details|upgrade|cancel))?$/.exec(path);
  if (!billing) return undefined;
  if (!email) return toLogin(path);
  const org = organizations(ctx).find((o) => o.id === billing[1] && o.admin === email);
  if (!org) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  const act = billing[2];
  if (!act && request.method === 'GET') return billingPage(email, org);
  if (!act || request.method !== 'POST') return undefined;
  const f = formOf(ctx);
  if (act === 'details') {
    if (!(f.cardholder ?? '').trim()) return billingPage(email, org, 'Enter the cardholder name.', 422);
    if (!luhn(f.card_number ?? '')) return billingPage(email, org, 'That card number is not valid.', 422);
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test((f.expiry ?? '').trim())) return billingPage(email, org, 'Enter the expiry as MM/YY.', 422);
    const [mm, yy] = f.expiry!.trim().split('/').map(Number);
    if (Date.UTC(2000 + yy!, mm!, 1) <= now) return billingPage(email, org, 'That card has expired.', 422);
    if (!/^\d{3,4}$/.test((f.cvc ?? '').trim())) return billingPage(email, org, 'Enter the CVC.', 422);
    const card = f.card_number!.replace(/[\s-]/g, '').slice(-4);
    await record(ctx, '_organization', org.id, { card, cardholder: f.cardholder!.trim(), billing_country: (f.country ?? '').trim() });
    return billingPage(email, { ...org, card }, `Billing details saved: card ending ${card}.`);
  }
  if (act === 'upgrade') {
    if (!org.card) return billingPage(email, org, 'Add billing details before you choose a Developer plan.', 422);
    if (!PLANS.some((p) => p.value === f.plan && p.value !== 'free')) return billingPage(email, org, 'Choose a plan size.', 422);
    await record(ctx, '_organization', org.id, { plan: f.plan!, status: 'active' });
    return billingPage(email, { ...org, plan: f.plan!, status: 'active' }, `Upgraded to ${PLANS.find((p) => p.value === f.plan)!.label}.`);
  }
  if (f.confirm !== 'yes') return billingPage(email, org, 'Review the information and confirm.', 422);
  if (!org.plan.startsWith('developer') || org.status === 'canceled') return billingPage(email, org, 'There is no Developer plan to cancel.', 422);
  const invoice = `in_${hex(`tinybird-twin:invoice:${org.id}:${occurredAt}`).slice(0, 16)}`;
  await record(ctx, '_invoice', invoice, { invoice, organization: org.id, kind: 'final', status: 'charged', card: org.card, at: occurredAt });
  await record(ctx, '_organization', org.id, { status: 'canceled', canceled_at: occurredAt });
  return billingPage(email, { ...org, status: 'canceled' }, `Developer plan canceled. Remaining costs were charged to the card ending ${org.card}: final invoice ${invoice}.`);
}
