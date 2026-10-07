// The browser's client, the `/client` family of the Frontend API: the client itself (spec:/components/schemas/
// Client.Client), its sign-ups (spec:/components/schemas/Client.SignUp), its sign-ins (spec:/components/schemas/
// Client.SignIn) and its sessions. Every answer that changes the client carries it (`{ response, client }`,
// spec:/components/schemas/Client.ClientWrappedSignIn and its siblings).
//
// A sign-up is collected field by field until the instance's requirements hold (an email address, verified, and a
// password where the instance takes one), when Clerk makes the user and a session. The address is verified by a one-time
// code Clerk sends (`prepare_verification` / `attempt_verification`, strategy `email_code`), or by an invitation's ticket
// ("After the below call, the user's email address will be automatically verified because of the invitation token":
// https://clerk.com/docs/guides/development/custom-flows/organizations/accept-organization-invitations). A sign-in names
// its user by an identifier (their email address) and proves it with a first factor (an emailed code, or the password),
// or is made with a ticket, which names and proves at once. A session is touched to pick the active organization, asked
// for tokens, ended and removed. Every move of a `status` asks the machine (./states.ts). Google is offered by the configured social connection; enterprise strategies
// remain outside this sign-in flow.
import type { HandlerContext } from '@volter/world-core';
import {
  frontendGap,  authSettings, OAUTH_LIFETIME_MS, PROVIDERS, oauthCallbackUrl,  acceptInvitation, activeSessions, codeRefusal, consumeSignInToken, isTestEmail, MAX_CODE_ATTEMPTS, TEST_CODE, ATTEMPT_LIFETIME_MS, clientTokenHeader, clientView, CODE_LIFETIME_MS, COOKIE_LIFETIME_MS, cookieClient, createSession,
  createUser, ensureClient, fapiError, invalidParam, machineRefusal, membershipsOf, missingParam, ms, notFound, oneTimeCode, originOf, own, PASSWORD_MIN_LENGTH,
  passwordDigest, passwordMatches, primaryEmail, readTicket, remember, requireClient, requiredSignUpFields, rootOf, type ClientRef, type Row,
  sessionToken, sessionView, sha256, signedOut, templateToken, text, ticketRefused, tokenOrganization, userByEmail, wrapped,
  devBrowserToken, HANDSHAKE, handshakeDirectives, signJwt, 
} from './shared.ts';

// ── the client ────────────────────────────────────────────────────────────────────────────────

/** `GET /v1/client`: "Returns the current client that is present either in the browser cookies or authorization header."
 *  With no cookie, Clerk's own instance answered a new client, set no cookie and kept nothing (the recording); the twin
 *  answers the same, its id derived from the instant. */
export async function getClient(ctx: HandlerContext): Promise<Response> {
  const named = cookieClient(ctx);
  if (!named) {
    const at = ms(ctx);
    return ctx.reply({
      response: {
        object: 'client', id: `client_${sha256(`client:${ctx.occurredAt}`).slice(0, 27)}`, sessions: [], sign_in: null, sign_up: null, last_active_session_id: null,
        last_authentication_strategy: null, cookie_expires_at: at + COOKIE_LIFETIME_MS, captcha_bypass: false, created_at: at, updated_at: at,
      },
      client: null,
    });
  }
  return ctx.reply({ response: clientView(ctx, await rootOf(ctx), named), client: null });
}

/** `PUT` and `POST /v1/client`: "Creates a new Client and sets it either in the response cookies or the response
 *  authorization header." A browser that already holds a client keeps it: clerk-js calls this to make sure its client
 *  exists, and a new one would sign it out (where the spec's "new" is not settled, the twin keeps the browser signed in). */
async function newClient(ctx: HandlerContext): Promise<Response> {
  const client = await ensureClient(ctx);
  return new Response(JSON.stringify({ response: clientView(ctx, await rootOf(ctx), client.id), client: null }), {
    status: 200, headers: [['content-type', 'application/json'], clientTokenHeader(ctx, client.id)],
  });
}
export async function putClient(ctx: HandlerContext): Promise<Response> {
  return newClient(ctx);
}
export async function postClient(ctx: HandlerContext): Promise<Response> {
  return newClient(ctx);
}

// ── sign-ups ──────────────────────────────────────────────────────────────────────────────────

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The verification of the sign-up's email address, before any code is asked for: it "needs_prepare"
 *  (spec:/components/schemas/Stubs.SignUpVerification.AdditionalFields/properties/next_action). */
const needsPrepare = (): Row => ({ status: 'unverified', strategy: 'email_code', attempts: null, expire_at: null, next_action: 'needs_prepare', supported_strategies: ['email_code'] });

const emailVerification = (su: Row): Row | null => ((su.verifications as Row | undefined)?.email_address as Row | null | undefined) ?? null;

/** What the sign-up still lacks: required fields not given, and given identifiers not verified. */
function requirements(root: HandlerContext, su: Row): { missing: string[]; unverified: string[] } {
  const given: Record<string, boolean> = { email_address: typeof su.email_address === 'string', password: su.password_enabled === true || su._external != null, legal_accepted: su.legal_accepted_at != null };
  const missing = requiredSignUpFields(root).filter((f) => !given[f]);
  const unverified = typeof su.email_address === 'string' && emailVerification(su)?.status !== 'verified' ? ['email_address'] : [];
  return { missing, unverified };
}

/** The sign-up's own client, or Clerk's refusal. */
function ownSignUp(ctx: HandlerContext): { su: Row; clientId: string } | Response {
  const clientId = cookieClient(ctx);
  if (!clientId) return signedOut();
  const su = ctx.row('Client.SignUp', String(ctx.call.params.sign_up_id));
  // "Returns the sign-up by ID. Must be associated with the current Client object."
  if (!su || su._client_id !== clientId) return notFound('Sign-up');
  return { su, clientId };
}

/** Finish a sign-up whose requirements hold: the user, the invitation it came by, and a session on the client. */
async function complete(ctx: HandlerContext, root: HandlerContext, su: Row, clientId: string): Promise<Row | Response> {
  const email = String(su.email_address);
  if (userByEmail(root, email)) return fapiError(422, 'form_identifier_exists', 'That email address is taken. Please try another.', 'That email address is taken. Please try another.', { param_name: 'email_address' });
  const by = String(emailVerification(su)?.strategy ?? 'email_code');
  const verifiedBy = by === 'ticket' ? 'ticket' : /^from_oauth_/.test(by) ? (by as `from_oauth_${string}`) : 'email_code';
  const user = await createUser(root, {
    email, verifiedBy, ...(typeof su._password_digest === 'string' ? { passwordDigest: su._password_digest } : {}),
    firstName: (su.first_name as string | null) ?? null, lastName: (su.last_name as string | null) ?? null, username: (su.username as string | null) ?? null,
    unsafeMetadata: (su.unsafe_metadata as Row | undefined) ?? {}, legalAcceptedAt: (su.legal_accepted_at as number | null) ?? null,
  });
  const userId = String(user.id);
  if (typeof su._invitation_id === 'string') {
    const invitation = root.get('OrganizationInvitation', su._invitation_id);
    if (invitation && (invitation.status ?? 'pending') === 'pending') {
      const refusal = await acceptInvitation(root, invitation, userId);
      if (refusal) return refusal;
    }
  }
  const session = await createSession(ctx, root, userId, clientId);
  return { created_user_id: userId, created_session_id: String(session.id) };
}

/** Write the sign-up with its requirements worked out, its status moved as the machine allows (`operationId`), and the
 *  user made when it completes. */
async function settleSignUp(ctx: HandlerContext, root: HandlerContext, client: ClientRef, id: string, fields: Row, current: string): Promise<Response> {
  const draft: Row = { ...(ctx.row('Client.SignUp', id) ?? {}), ...fields };
  const { missing, unverified } = requirements(root, draft);
  const to = missing.length === 0 && unverified.length === 0 ? 'complete' : 'missing_requirements';
  const refused = ctx.legal('Client.SignUp', 'status', ctx.call.operation.id, current, to, id);
  if (refused) return machineRefusal(refused);
  let made: Row = {};
  if (to === 'complete') {
    const done = await complete(ctx, root, draft, client.id);
    if (done instanceof Response) return done;
    made = done;
  }
  const row = await ctx.write('Client.SignUp', id, { ...fields, status: to, missing_fields: missing, unverified_fields: unverified, ...made, updated_at: ms(ctx) }, current === 'missing_requirements' && !ctx.row('Client.SignUp', id) ? 'sign_up.create' : 'sign_up.update');
  // a completed sign-up leaves the client: its session is what the client now holds
  await remember(ctx, client.id, { sign_up: to === 'complete' ? null : id, ...(to === 'complete' ? { sign_in: null, strategy: String(emailVerification(row)?.strategy ?? 'email_code') } : {}) });
  return wrapped(ctx, root, client, own(ctx, row));
}

/** The fields a create or an update gives, checked as Clerk checks them. */
async function fieldsFrom(ctx: HandlerContext, root: HandlerContext, id: string, existing: Row | undefined): Promise<Row | Response> {
  const out: Row = {};
  const email = text(ctx, 'email_address') ?? text(ctx, 'email_address_or_phone_number');
  const strategy = text(ctx, 'strategy');
  if (strategy === 'ticket') {
    const ticket = readTicket(root, text(ctx, 'ticket'));
    if (ticket instanceof Response) return ticket;
    // https://clerk.com/docs/guides/development/errors/frontend-api: SignInTokenCanBeUsedOnlyInSignIn
    if (ticket.kind !== 'invitation') return ticketRefused('token_not_in_sign_in');
    out.email_address = ticket.email;
    out._invitation_id = ticket.invitation.id;
    // the invitation's ticket verifies its address (the page above)
    out.verifications = { ...((existing?.verifications as Row | undefined) ?? {}), email_address: { status: 'verified', strategy: 'ticket', attempts: null, expire_at: null, next_action: '', supported_strategies: [] } };
  } else if (email !== undefined) {
    if (!EMAIL.test(email)) return invalidParam('email_address', 'email_address must be a valid email address.');
    if (email.toLowerCase() !== existing?.email_address) {
      out.email_address = email.toLowerCase();
      out.verifications = { ...((existing?.verifications as Row | undefined) ?? {}), email_address: needsPrepare() };
      out._email_code = null;
    }
  }
  if (typeof out.email_address === 'string' && userByEmail(root, out.email_address)) {
    return fapiError(422, 'form_identifier_exists', 'That email address is taken. Please try another.', 'That email address is taken. Please try another.', { param_name: 'email_address' });
  }
  const password = text(ctx, 'password');
  if (password !== undefined) {
    if (password.length >= 72) return fapiError(422, 'form_password_length_too_long', 'Passwords must be less than 72 characters.', 'Passwords must be less than 72 characters.', { param_name: 'password' });
    if (password.length < PASSWORD_MIN_LENGTH) return fapiError(422, 'form_password_length_too_short', `Passwords must be ${PASSWORD_MIN_LENGTH} characters or more.`, `Passwords must be ${PASSWORD_MIN_LENGTH} characters or more.`, { param_name: 'password' });
    out._password_digest = passwordDigest(password, `sign_up:${id}`);
    out.password_enabled = true;
  }
  for (const k of ['first_name', 'last_name', 'username'] as const) { const v = text(ctx, k); if (v !== undefined) out[k] = v; }
  const unsafe = text(ctx, 'unsafe_metadata');
  if (unsafe !== undefined) {
    try { out.unsafe_metadata = JSON.parse(unsafe) as Row; } catch { return invalidParam('unsafe_metadata', 'unsafe_metadata must be a JSON object.'); }
  }
  // "Has the value `true` if the user has accepted the legal requirements." (spec createSignUps)
  if (ctx.params.legal_accepted === true || ctx.params.legal_accepted === 'true') out.legal_accepted_at = ms(ctx);
  return out;
}

/** `POST /v1/client/sign_ups`: "Creates or replaces the sign-up on the current Client object." */
export async function createSignUps(ctx: HandlerContext): Promise<Response> {
  const client = await ensureClient(ctx);
  const root = await rootOf(ctx);
  const id = ctx.mint('Client.SignUp');
  // source: spec:createSignUps "transfer"
  const transferred = ctx.params.transfer === true || ctx.params.transfer === 'true' ? transferFrom(ctx, client.id) : undefined;
  if (transferred instanceof Response) return transferred;
  const fields = transferred ?? await fieldsFrom(ctx, root, id, undefined);
  if (fields instanceof Response) return fields;
  const at = ms(ctx);
  const base: Row = {
    object: 'sign_up_attempt', status: 'missing_requirements', required_fields: requiredSignUpFields(root), optional_fields: ['first_name', 'last_name'],
    missing_fields: [], unverified_fields: [],
    verifications: { email_address: null, phone_number: null, web3_wallet: null, external_account: null },
    username: null, email_address: null, phone_number: null, web3_wallet: null, password_enabled: false, first_name: null, last_name: null,
    unsafe_metadata: {}, public_metadata: {}, custom_action: false, external_id: null, created_session_id: null, created_user_id: null,
    abandon_at: at + ATTEMPT_LIFETIME_MS, legal_accepted_at: null, created_at: at, _client_id: client.id,
  };
  return settleSignUp(ctx, root, client, id, { ...base, ...fields }, 'missing_requirements');
}

/** The fields a sign-up takes from the client's transferable sign-in: the provider's person, their address verified by
 *  the provider (`from_oauth_<provider>`), and the external account it came by. */
function transferFrom(ctx: HandlerContext, clientId: string): Row | Response {
  const si = ctx.rowsRaw('Client.SignIn').filter((r) => r._client_id === clientId && (r.first_factor_verification as Row | null)?.status === 'transferable')
    .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0)).at(-1);
  const external = si?._external as Row | undefined;
  // https://clerk.com/docs/guides/development/errors/frontend-api: a transfer with nothing to transfer
  if (!si || !external) return fapiError(400, 'sign_up_transfer_not_found', 'no transferable sign in', 'There is no transferable sign in to sign up with.');
  const strategy = String((si.first_factor_verification as Row).strategy);
  return {
    email_address: String(external.email).toLowerCase(), first_name: external.first_name ?? null, last_name: external.last_name ?? null,
    verifications: { email_address: { status: 'verified', strategy: `from_${strategy}`, attempts: null, expire_at: null, next_action: '', supported_strategies: [] }, external_account: { status: 'verified', strategy, attempts: null, expire_at: null } },
    _external: external, _transferred_from: si.id,
  };
}

/** `PATCH /v1/client/sign_ups/{id}`: "Updates the sign-up object specified by ID, with the supplied parameters." */
export async function updateSignUps(ctx: HandlerContext): Promise<Response> {
  const found = ownSignUp(ctx);
  if (found instanceof Response) return found;
  const { su, clientId } = found;
  // SignUpCannotBeUpdated, 403, is documented on the Backend API's errors page (the Frontend API's has no entry for it)
  // source: https://clerk.com/docs/guides/development/errors/backend-api "This sign up has reached a terminal state and cannot be updated"
  if (su.status === 'complete') return fapiError(403, 'sign_up_cannot_be_updated', 'Sign up cannot be updated', 'This sign up has reached a terminal state and cannot be updated');
  const root = await rootOf(ctx);
  const fields = await fieldsFrom(ctx, root, String(su.id), su);
  if (fields instanceof Response) return fields;
  return settleSignUp(ctx, root, { id: clientId }, String(su.id), fields, String(su.status ?? 'missing_requirements'));
}

/** `GET /v1/client/sign_ups/{id}`. */
export async function getSignUps(ctx: HandlerContext): Promise<Response> {
  const found = ownSignUp(ctx);
  if (found instanceof Response) return found;
  const root = await rootOf(ctx);
  return ctx.reply({ response: own(ctx, found.su), client: clientView(ctx, root, found.clientId) });
}

/** `POST /v1/client/sign_ups/{id}/prepare_verification`: "for `email_code`, the API will send a verification email to the
 *  email address currently load up in the sign-up". The code is kept on the sign-up; the email is kept where a World reads
 *  what Clerk sent (`_email`). */
export async function prepareSignUpsVerification(ctx: HandlerContext): Promise<Response> {
  const found = ownSignUp(ctx);
  if (found instanceof Response) return found;
  const { su, clientId } = found;
  const strategy = text(ctx, 'strategy');
  if (strategy !== 'email_code') return invalidParam('strategy', `${strategy ?? '(none)'} is not a verification strategy this instance offers; it offers email_code.`);
  if (typeof su.email_address !== 'string') return fapiError(422, 'form_param_missing', 'is missing', 'The sign-up has no email address to verify.', { param_name: 'email_address' });
  if (emailVerification(su)?.status === 'verified') return codeRefusal.alreadyVerified();
  const at = ms(ctx);
  // a test address is sent nothing, and takes the test code (isTestEmail)
  const test = isTestEmail(su.email_address);
  const code = test ? TEST_CODE : oneTimeCode(await ctx.secret(`sign_up:${String(su.id)}:${ctx.occurredAt}`));
  const root = await rootOf(ctx);
  const row = await ctx.write('Client.SignUp', String(su.id), {
    verifications: { ...((su.verifications as Row | undefined) ?? {}), email_address: { status: 'unverified', strategy: 'email_code', attempts: 0, expire_at: at + CODE_LIFETIME_MS, next_action: 'needs_attempt', supported_strategies: ['email_code'] } },
    _email_code: code, updated_at: at,
  }, 'sign_up.prepare_verification');
  if (!test) await ctx.record('_email', { to: su.email_address, template: 'verification_code', subject: `${code} is your verification code`, code, sign_up_id: su.id, sent_at: at });
  return wrapped(ctx, root, { id: clientId }, own(ctx, row));
}

/** `POST /v1/client/sign_ups/{id}/attempt_verification`: "Attempts to verify the identification that corresponds to the
 *  given strategy using the given verification code." A verified address with nothing else missing completes the sign-up. */
export async function attemptSignUpsVerification(ctx: HandlerContext): Promise<Response> {
  const found = ownSignUp(ctx);
  if (found instanceof Response) return found;
  const { su, clientId } = found;
  if (text(ctx, 'strategy') !== 'email_code') return invalidParam('strategy', 'This instance verifies email addresses with email_code.');
  const verification = emailVerification(su);
  const code = text(ctx, 'code');
  if (verification?.status === 'verified') return codeRefusal.alreadyVerified();
  if (!verification || typeof su._email_code !== 'string') return codeRefusal.notSent();
  if (verification.status === 'failed') return codeRefusal.failed();
  if (!code) return missingParam('code');
  const at = ms(ctx);
  const root = await rootOf(ctx);
  if (typeof verification.expire_at === 'number' && at > verification.expire_at) {
    await ctx.write('Client.SignUp', String(su.id), { verifications: { ...(su.verifications as Row), email_address: { ...verification, status: 'expired' } }, updated_at: at }, 'sign_up.attempt_verification');
    return codeRefusal.expired();
  }
  const attempts = Number(verification.attempts ?? 0) + 1;
  if (code !== su._email_code) {
    const failed = attempts >= MAX_CODE_ATTEMPTS;
    await ctx.write('Client.SignUp', String(su.id), { verifications: { ...(su.verifications as Row), email_address: { ...verification, attempts, ...(failed ? { status: 'failed' } : {}) } }, updated_at: at }, 'sign_up.attempt_verification');
    return failed ? codeRefusal.failed() : codeRefusal.incorrect();
  }
  return settleSignUp(ctx, root, { id: clientId }, String(su.id), {
    verifications: { ...(su.verifications as Row), email_address: { ...verification, status: 'verified', attempts, next_action: '', supported_strategies: [] } },
    _email_code: null,
  }, String(su.status ?? 'missing_requirements'));
}

// ── sign-ins ──────────────────────────────────────────────────────────────────────────────────

const notFoundIdentifier = (): Response => fapiError(422, 'form_identifier_not_found', "Couldn't find your account.", "Couldn't find your account.", { param_name: 'identifier' });
const wrongPassword = (): Response => fapiError(422, 'form_password_incorrect', 'Password is incorrect. Try again, or use another method.', 'Password is incorrect. Try again, or use another method.', { param_name: 'password' });

const emailsOfUser = (user: Row): Row[] => (Array.isArray(user.email_addresses) ? (user.email_addresses as Row[]) : []);

/** The first factors a user may prove themselves with (spec:/components/schemas/Stubs.SignInFactor): the password when they
 *  have one, and a code to each verified email address. */
function firstFactors(user: Row): Row[] {
  const primary = primaryEmail(user);
  return [
    ...(user.password_enabled === true ? [{ strategy: 'password' }] : []),
    ...emailsOfUser(user).filter((e) => (e.verification as Row | undefined)?.status === 'verified').map((e) => ({
      strategy: 'email_code', safe_identifier: e.email_address, email_address_id: e.id, primary: e.id === primary?.id, default: e.id === primary?.id,
    })),
  ];
}

const userData = (user: Row): Row => ({ first_name: user.first_name ?? null, last_name: user.last_name ?? null, image_url: user.image_url ?? '', has_image: user.has_image === true, profile_image_url: user.profile_image_url ?? user.image_url ?? '' });

function ownSignIn(ctx: HandlerContext): { si: Row; clientId: string } | Response {
  const clientId = cookieClient(ctx);
  if (!clientId) return signedOut();
  const si = ctx.row('Client.SignIn', String(ctx.call.params.sign_in_id));
  // "The sign in is returned only if it belongs to the requesting client and is not abandoned."
  if (!si || si._client_id !== clientId) return notFound('Sign-in');
  return { si, clientId };
}

/** Move the sign-in's status as the machine allows, and complete it with a session when it reaches `complete`. */
async function settleSignIn(ctx: HandlerContext, root: HandlerContext, client: ClientRef, id: string, fields: Row, current: string, to: string, strategy: string, activeOrg: string | null = null): Promise<Response> {
  const refused = ctx.legal('Client.SignIn', 'status', ctx.call.operation.id, current, to, id);
  if (refused) return machineRefusal(refused);
  const made: Row = {};
  if (to === 'complete') {
    const session = await createSession(ctx, root, String(fields._user_id ?? ctx.row('Client.SignIn', id)?._user_id), client.id, activeOrg);
    made.created_session_id = String(session.id);
  }
  const creating = !ctx.row('Client.SignIn', id);
  const row = await ctx.write('Client.SignIn', id, { ...fields, status: to, ...made, updated_at: ms(ctx) }, creating ? 'sign_in.create' : 'sign_in.update');
  // a completed sign-in leaves the client: its session is what the client now holds
  await remember(ctx, client.id, { sign_in: to === 'complete' ? null : id, ...(to === 'complete' ? { strategy } : {}) });
  return wrapped(ctx, root, client, own(ctx, row));
}

/** A new sign-in's fields, for the user it names. */
function base(ctx: HandlerContext, clientId: string, user: Row, identifier: string): Row {
  return {
    object: 'sign_in_attempt', supported_identifiers: ['email_address'], supported_first_factors: firstFactors(user), supported_second_factors: [],
    first_factor_verification: null, second_factor_verification: null, identifier, user_data: userData(user), created_session_id: null,
    abandon_at: ms(ctx) + ATTEMPT_LIFETIME_MS, created_at: ms(ctx), _client_id: clientId, _user_id: user.id,
  };
}

/** Send a sign-in code to one of the user's addresses; the code is kept on the sign-in, the email in `_email`. */
async function sendCode(ctx: HandlerContext, id: string, user: Row, emailId: unknown): Promise<Row | Response> {
  const email = emailsOfUser(user).find((e) => e.id === emailId) ?? (emailId === undefined ? primaryEmail(user) : undefined);
  if (!email) return invalidParam('email_address_id', 'email_address_id must name one of the user\'s email addresses.');
  const at = ms(ctx);
  // a test address is sent nothing, and takes the test code (isTestEmail)
  const test = isTestEmail(email.email_address);
  const code = test ? TEST_CODE : oneTimeCode(await ctx.secret(`sign_in:${id}:${ctx.occurredAt}`));
  if (!test) await ctx.record('_email', { to: email.email_address, template: 'verification_code', subject: `${code} is your verification code`, code, sign_in_id: id, sent_at: at });
  return { first_factor_verification: { status: 'unverified', strategy: 'email_code', attempts: 0, expire_at: at + CODE_LIFETIME_MS }, _email_code: code, _email_address_id: email.id };
}

/** A sign-in by a social connection: the sign-in waits on its provider (`needs_identifier`, its first factor's verification
 *  `unverified` with the provider's page to go to), and the browser is sent to that page — the World's own twin of the
 *  provider, as Clerk sends it to the provider — with the instance's OAuth client, the Frontend API's callback and a state
 *  naming this sign-in. `redirect_url` is where the callback returns the browser (clerk-js's `/sso-callback`). */
// source: spec:/components/schemas/Stubs.Verification.Oauth "external_verification_redirect_url"
async function startOAuth(ctx: HandlerContext, root: HandlerContext, client: ClientRef, id: string, strategy: string): Promise<Response> {
  const connection = authSettings(root).social[strategy];
  const provider = PROVIDERS[strategy];
  // an instance that has not enabled the connection refuses its strategy as any strategy it does not offer
  if (!connection || !provider) return invalidParam('strategy', `${strategy} is not a sign-in strategy this instance offers.`);
  const redirect = text(ctx, 'redirect_url');
  if (!redirect) return missingParam('redirect_url');
  const at = ms(ctx);
  const state = sha256(`oauth_state:${id}:${ctx.occurredAt}`).slice(0, 32);
  const authorize = new URL(provider.authorize);
  authorize.searchParams.set('client_id', connection.client_id);
  authorize.searchParams.set('redirect_uri', oauthCallbackUrl(root));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', provider.scope);
  authorize.searchParams.set('state', state);
  const fields: Row = {
    object: 'sign_in_attempt', supported_identifiers: ['email_address'], supported_first_factors: [{ strategy }], supported_second_factors: [],
    first_factor_verification: { status: 'unverified', strategy, external_verification_redirect_url: authorize.toString(), error: null, attempts: null, expire_at: at + OAUTH_LIFETIME_MS },
    second_factor_verification: null, identifier: null, user_data: null, created_session_id: null,
    abandon_at: at + ATTEMPT_LIFETIME_MS, created_at: at, _client_id: client.id, _oauth_state: state,
    _redirect_url: redirect, _action_complete_redirect_url: text(ctx, 'action_complete_redirect_url') ?? null,
  };
  return settleSignIn(ctx, root, client, id, fields, 'needs_identifier', 'needs_identifier', strategy);
}

/** `POST /v1/client/sign_ins`: "Creates or replaces the current Sign in object." Parameter rules: `password` needs an
 *  identifier and a password, `email_code` an identifier (the code is sent at once), `ticket` a ticket. */
export async function createSignIn(ctx: HandlerContext): Promise<Response> {
  const client = await ensureClient(ctx);
  const root = await rootOf(ctx);
  const id = ctx.mint('Client.SignIn');
  const strategy = text(ctx, 'strategy');
  if (strategy === 'ticket') {
    const ticket = readTicket(root, text(ctx, 'ticket'));
    if (ticket instanceof Response) return ticket;
    const user = ticket.kind === 'invitation' ? userByEmail(root, ticket.email) : root.get('User', ticket.userId);
    // an invitation to someone with no account is a sign-up's (`__clerk_status=sign_up` on the invitation's link):
    // https://clerk.com/docs/guides/development/errors/frontend-api, OrganizationInvitationIdentificationNotExist
    // source: https://clerk.com/docs/guides/development/errors/frontend-api "User not found. If you don't have an account, sign up first to accept this invitation."
    if (!user) return fapiError(400, 'organization_invitation_identification_not_exist', 'identification not found', "User not found. If you don't have an account, sign up first to accept this invitation.", { param_name: 'ticket' });
    const refusal = ticket.kind === 'invitation' ? await acceptInvitation(root, ticket.invitation, String(user.id)) : await consumeSignInToken(root, ticket.token);
    if (refusal) return refusal;
    const identifier = String(primaryEmail(user)?.email_address ?? user.id);
    // a sign-in token made with `org_id`: "when the token is redeemed, Clerk activates that Organization for the new
    // session" (https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token)
    const activeOrg = ticket.kind === 'sign_in_token' ? ticket.orgId : null;
    return settleSignIn(ctx, root, client, id, { ...base(ctx, client.id, user, identifier), first_factor_verification: { status: 'verified', strategy: 'ticket', attempts: null, expire_at: null } }, 'needs_identifier', 'complete', 'ticket', activeOrg);
  }
  // Social-provider sign-in is outside this instance's served flow.
  if (strategy !== undefined && /^oauth_/.test(strategy)) return startOAuth(ctx, root, client, id, strategy);
  if (strategy !== undefined && !['password', 'email_code', 'ticket'].includes(strategy)) return frontendGap(ctx, true);
  const identifier = text(ctx, 'identifier');
  if (!identifier) return missingParam('identifier');
  const user = userByEmail(root, identifier);
  if (!user) return notFoundIdentifier();
  const fields = base(ctx, client.id, user, identifier);
  const password = text(ctx, 'password');
  if (strategy === 'password' || (strategy === undefined && password !== undefined && password !== '')) {
    if (!password) return missingParam('password');
    if (!passwordMatches(password, root.row('User', String(user.id))?._password_digest)) return wrongPassword();
    return settleSignIn(ctx, root, client, id, { ...fields, first_factor_verification: { status: 'verified', strategy: 'password', attempts: 1, expire_at: null } }, 'needs_identifier', 'complete', 'password');
  }
  if (strategy === 'email_code') {
    const sent = await sendCode(ctx, id, user, undefined);
    if (sent instanceof Response) return sent;
    Object.assign(fields, sent);
  }
  return settleSignIn(ctx, root, client, id, fields, 'needs_identifier', 'needs_first_factor', strategy ?? 'email_code');
}

/** `GET /v1/client/sign_ins/{id}`. */
export async function getSignIn(ctx: HandlerContext): Promise<Response> {
  const found = ownSignIn(ctx);
  if (found instanceof Response) return found;
  const root = await rootOf(ctx);
  return ctx.reply({ response: own(ctx, found.si), client: clientView(ctx, root, found.clientId) });
}

/** `POST /v1/client/sign_ins/{id}/prepare_first_factor`: "If the strategy equals email_code then this request will send an
 *  email with an OTP code." */
export async function prepareSignInFactorOne(ctx: HandlerContext): Promise<Response> {
  const found = ownSignIn(ctx);
  if (found instanceof Response) return found;
  const { si, clientId } = found;
  // a sign-in past its first factor (complete: no second factor is offered) has its first factor verified
  // (https://clerk.com/docs/guides/development/errors/frontend-api, VerificationAlreadyVerified)
  if (si.status !== 'needs_first_factor') return codeRefusal.alreadyVerified();
  const strategy = text(ctx, 'strategy');
  if (strategy !== 'email_code') return invalidParam('strategy', `${strategy ?? '(none)'} is not a first factor this instance prepares; it prepares email_code.`);
  const root = await rootOf(ctx);
  const user = root.get('User', String(si._user_id));
  if (!user) return notFoundIdentifier();
  const sent = await sendCode(ctx, String(si.id), user, text(ctx, 'email_address_id'));
  if (sent instanceof Response) return sent;
  const row = await ctx.write('Client.SignIn', String(si.id), { ...sent, updated_at: ms(ctx) }, 'sign_in.prepare_first_factor');
  return wrapped(ctx, root, { id: clientId }, own(ctx, row));
}

/** `POST /v1/client/sign_ins/{id}/attempt_first_factor`: "If the strategy equals `email_code` or `phone_code` then a code is
 *  required. If the strategy equals `password` then a password is required." */
export async function attemptSignInFactorOne(ctx: HandlerContext): Promise<Response> {
  const found = ownSignIn(ctx);
  if (found instanceof Response) return found;
  const { si, clientId } = found;
  const root = await rootOf(ctx);
  const current = String(si.status ?? 'needs_identifier');
  if (current === 'complete') {
    const refused = ctx.legal('Client.SignIn', 'status', 'attemptSignInFactorOne', current, 'complete', String(si.id));
    if (refused) return machineRefusal(refused);
  }
  const user = root.get('User', String(si._user_id));
  if (!user) return notFoundIdentifier();
  const strategy = text(ctx, 'strategy');
  const at = ms(ctx);
  if (strategy === 'password') {
    const password = text(ctx, 'password');
    if (!password) return missingParam('password');
    if (!passwordMatches(password, root.row('User', String(user.id))?._password_digest)) return wrongPassword();
    return settleSignIn(ctx, root, { id: clientId }, String(si.id), { first_factor_verification: { status: 'verified', strategy: 'password', attempts: 1, expire_at: null } }, current, 'complete', 'password');
  }
  if (strategy !== 'email_code') return invalidParam('strategy', `${strategy ?? '(none)'} is not a first factor this instance offers.`);
  const verification = si.first_factor_verification as Row | null;
  const code = text(ctx, 'code');
  if (!verification || verification.strategy !== 'email_code' || typeof si._email_code !== 'string') return codeRefusal.notSent();
  if (verification.status === 'failed') return codeRefusal.failed();
  if (!code) return missingParam('code');
  if (typeof verification.expire_at === 'number' && at > verification.expire_at) {
    await ctx.write('Client.SignIn', String(si.id), { first_factor_verification: { ...verification, status: 'expired' }, updated_at: at }, 'sign_in.attempt_first_factor');
    return codeRefusal.expired();
  }
  const attempts = Number(verification.attempts ?? 0) + 1;
  if (code !== si._email_code) {
    const failed = attempts >= MAX_CODE_ATTEMPTS;
    await ctx.write('Client.SignIn', String(si.id), { first_factor_verification: { ...verification, attempts, ...(failed ? { status: 'failed' } : {}) }, updated_at: at }, 'sign_in.attempt_first_factor');
    return failed ? codeRefusal.failed() : codeRefusal.incorrect();
  }
  return settleSignIn(ctx, root, { id: clientId }, String(si.id), { first_factor_verification: { ...verification, status: 'verified', attempts }, _email_code: null }, current, 'complete', 'email_code');
}

// ── sessions ──────────────────────────────────────────────────────────────────────────────────

/** The session a path names, on the request's client. */
function sessionOnClient(ctx: HandlerContext): { session: Row; clientId: string } | Response {
  const client = requireClient(ctx);
  if (client instanceof Response) return client;
  const session = ctx.get('Client.Session-2', String(ctx.call.params.session_id));
  if (!session || session.client_id !== client.id) return notFound('Session');
  return { session, clientId: client.id };
}

/** `GET /v1/client/sessions/{session_id}`. */
export async function getSession(ctx: HandlerContext): Promise<Response> {
  const found = sessionOnClient(ctx);
  if (found instanceof Response) return found;
  const root = await rootOf(ctx);
  return ctx.reply({ response: sessionView(ctx, root, found.session), client: clientView(ctx, root, found.clientId) });
}

/** `POST /v1/client/sessions/{id}/touch`: "Specify the active session for the client." With `active_organization_id` ("The
 *  ID or slug of the organization to activate"; empty for the personal account) the session's active organization moves,
 *  and only to one its user belongs to. */
export async function touchSession(ctx: HandlerContext): Promise<Response> {
  const found = sessionOnClient(ctx);
  if (found instanceof Response) return found;
  const { session, clientId } = found;
  if ((session.status ?? 'active') !== 'active') return notFound('Session');
  const root = await rootOf(ctx);
  const patch: Row = { last_active_at: ms(ctx), updated_at: ms(ctx) };
  const requested = text(ctx, 'active_organization_id');
  if (requested !== undefined) {
    if (requested === '' || requested === 'null') patch.last_active_organization_id = null;
    else {
      const org = root.rows('Organization').find((o) => o.id === requested || o.slug === requested);
      const member = org && membershipsOf(root, String(session.user_id)).some((m) => m.organization_id === org.id);
      // https://clerk.com/docs/guides/development/errors/frontend-api: OrganizationNotFoundOrUnauthorized, 404
      // source: https://clerk.com/docs/guides/development/errors/frontend-api "Given organization not found, or you don't have permission to access the organization"
      if (!org || !member) return fapiError(404, 'organization_not_found_or_unauthorized', 'not found or unauthorized', "Given organization not found, or you don't have permission to access the organization");
      patch.last_active_organization_id = org.id;
    }
  }
  const row = await ctx.write('Client.Session-2', String(session.id), patch, 'session.touch');
  return ctx.reply({ response: sessionView(ctx, root, row), client: clientView(ctx, root, clientId) });
}

/** `POST /v1/client/sessions/{id}/tokens`: "Create a session JWT for the authenticated requested user." `organization_id`:
 *  "The user must be a member of the organization." */
export async function createSessionToken(ctx: HandlerContext): Promise<Response> {
  const found = sessionOnClient(ctx);
  if (found instanceof Response) return found;
  const { session } = found;
  if ((session.status ?? 'active') !== 'active') return fapiError(401, 'signed_out', 'Signed out', 'You are signed out');
  const root = await rootOf(ctx);
  const orgId = tokenOrganization(session, ctx.params.organization_id);
  if (orgId && !membershipsOf(root, String(session.user_id)).some((m) => m.organization_id === orgId)) {
    // https://clerk.com/docs/guides/development/errors/frontend-api: NotAMemberInOrganization, 403
    // source: https://clerk.com/docs/guides/development/errors/frontend-api "Current user is not a member of the organization."
    return fapiError(403, 'not_a_member_in_organization', 'not a member', 'Current user is not a member of the organization. Only organization members can perform this action.');
  }
  const jwt = sessionToken(root, session, { orgId, ...(originOf(ctx) ? { origin: originOf(ctx)! } : {}) });
  return ctx.reply({ object: 'token', jwt });
}

/** `POST /v1/client/sessions/{id}/tokens/{template_name}`: a token from the instance's JWT template of that name. */
export async function createSessionTokenWithTemplate(ctx: HandlerContext): Promise<Response> {
  const found = sessionOnClient(ctx);
  if (found instanceof Response) return found;
  const { session } = found;
  if ((session.status ?? 'active') !== 'active') return fapiError(401, 'signed_out', 'Signed out', 'You are signed out');
  const root = await rootOf(ctx);
  const name = decodeURIComponent(String(ctx.call.params.template_name));
  // raw: a template's own signing key is bookkeeping (`_signing_key`)
  const template = root.rowsRaw('JWTTemplate').find((t) => t.name === name);
  if (!template) return notFound(`JWT template ${name}`);
  const jwt = templateToken(root, session, template, { ...(originOf(ctx) ? { origin: originOf(ctx)! } : {}) });
  return ctx.reply({ object: 'token', jwt });
}

/** DELETE /v1/client/sessions: the SignIn account chooser's default signOut retains the client cookie. */
// source: spec:removeClientSessionsAndRetainCookie "Removes all the sessions of the current client without removing the __client cookie"
export async function removeClientSessionsAndRetainCookie(ctx: HandlerContext): Promise<Response> {
  const client = requireClient(ctx);
  if (client instanceof Response) return client;
  for (const session of activeSessions(ctx, client.id)) {
    ctx.legal('Client.Session-2', 'status', 'removeClientSessionsAndRetainCookie', session.status, 'removed', String(session.id));
    await ctx.write('Client.Session-2', String(session.id), { status: 'removed', updated_at: ms(ctx) }, 'session.remove');
  }
  const root = await rootOf(ctx);
  return ctx.reply({ response: clientView(ctx, root, client.id), client: null });
}

// ── the handshake ─────────────────────────────────────────────────────────────────────────────

/** `GET /v1/client/handshake`: "When the authentication status cannot be determined from the current session token, we
 *  initiate a handshake to refresh the token and send it back to the application" (spec: handshakeClient), answered
 *  "307 Redirect" to `redirect_url`. The browser's client (its `__client` cookie on this domain) decides the cookies the
 *  application is to set: its active session's token, or signed out; a development instance's dev browser rides along
 *  (`__clerk_db_jwt`). With `format=nonce` (what @clerk/backend asks for) the redirect carries a nonce the application
 *  exchanges at the Backend API (`GET /v1/clients/handshake_payload`); with `token`, the spec's default, it carries the
 *  cookies as a token the instance signs. */
// source: spec:handshakeClient "we initiate a handshake to refresh the token and send it back to the application"
// source: spec:handshakeClient "The URL to redirect back to after the handshake"
export async function handshakeClient(ctx: HandlerContext): Promise<Response> {
  const redirect = typeof ctx.params.redirect_url === 'string' ? ctx.params.redirect_url : '';
  let target: URL;
  try { target = new URL(redirect); } catch { return missingParam('redirect_url'); }
  const root = await rootOf(ctx);
  const clientId = cookieClient(ctx);
  const session = clientId === undefined ? undefined : activeSessions(ctx, clientId).at(-1);
  const devBrowser = await devBrowserToken(ctx);
  const directives = handshakeDirectives(root, session, devBrowser, target.origin);
  // source: spec:handshakeClient "enum nonce token default token"
  if (ctx.params.format === 'nonce') {
    // drawn from a secret the World holds (ctx.secret): the nonce fetches the handshake's cookies, a session among them
    const nonce = `hsn_${sha256(await ctx.secret(`handshake:${ctx.occurredAt}:${clientId ?? ''}:${redirect}`)).slice(0, 27)}`;
    await ctx.write(HANDSHAKE, nonce, { directives, created_at: ms(ctx) }, 'handshake.create');
    target.searchParams.set('__clerk_handshake_nonce', nonce);
  } else {
    const now = Math.floor(ms(ctx) / 1000);
    target.searchParams.set('__clerk_handshake', signJwt(ctx, { handshake: directives }, { now, expiresInSeconds: 60 }));
  }
  target.searchParams.set('__clerk_db_jwt', devBrowser);
  // source: spec:handshakeClient "Redirect"
  return ctx.raw(null, { status: 307, headers: { location: target.toString(), 'cache-control': 'no-store' } });
}
