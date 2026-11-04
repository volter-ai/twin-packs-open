// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`, standing in until the Dashboard's pages are built as screens: the API Keys page (a secret key, shown once), the
// Webhooks page (an endpoint and its signing secret), the Native applications page, and the User & authentication,
// Domains, Organizations Settings and SSO connections pages (the instance's settings); and what a person outside the
// vendor holds: the recipient's inbox (what Clerk emailed) and the receiver's requests (what Svix delivered).
import type { HandlerContext } from '@volter/world-core';
import { applicationFor, makeSecretKey, readSecretKey, webhookKey, ensureInstanceKey, instanceRow, publishableKey, instanceKey, INSTANCE_SUBJECT, ms, sha256, instanceId } from './shared.ts';

type Row = Record<string, unknown>;
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const bare = ({ type: _t, updatedAt: _u, ...m }: Row): Row => m;

/** GET /_twin/emails?to=<address>: what Clerk sent an address (invitations, verification codes), oldest first. */
export async function emails(ctx: HandlerContext): Promise<Response> {
  const to = new URL(ctx.call.request.url).searchParams.get('to')?.trim().toLowerCase();
  const data = ctx.rowsRaw('_email').filter((r) => to === undefined || String(r.to ?? '').toLowerCase() === to).map(bare).sort((a, b) => Number(a.sent_at ?? 0) - Number(b.sent_at ?? 0));
  return Response.json({ data, total_count: data.length });
}

/** GET /_twin/webhook-messages?type=: what Svix delivered, oldest first, as the receiver was sent them. */
export async function webhookMessages(ctx: HandlerContext): Promise<Response> {
  const type = new URL(ctx.call.request.url).searchParams.get('type');
  const data = ctx.rowsRaw('_webhook_message').filter((m) => !type || m.event_type === type).map(bare).sort((a, b) => Number(a.sent_at ?? 0) - Number(b.sent_at ?? 0));
  return Response.json({ data, total_count: data.length });
}

/** POST /_twin/secret-keys {name}: a secret key of the instance, as the API Keys page shows it once, kept by its hash; a
 *  development instance's keys begin `sk_test_`, a production one's `sk_live_`. */
export async function secretKeys(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const name = typeof b.name === 'string' ? b.name : null;
  const id = await makeSecretKey(ctx, name);
  return Response.json({ name, secret: await readSecretKey(ctx, ctx.row('_secret_key', id)!) }, { status: 201 });
}

/** POST /_twin/webhook-endpoints {url, events, signing_secret?}: an endpoint and the signing secret its page shows
 *  (`whsec_…`). A World whose application's configuration already holds a secret (`volter-world init` writes one for a
 *  webhook-secret variable) names it, as the page's rotate-secret does, so the application verifies what is delivered. */
export async function webhookEndpoints(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url)) return Response.json({ error: 'url is required' }, { status: 400 });
  if (b.signing_secret !== undefined && (typeof b.signing_secret !== 'string' || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(b.signing_secret))) return Response.json({ error: 'signing_secret must be whsec_ followed by base64' }, { status: 400 });
  const draw = await ctx.issue('_credential_serial');
  // the page's secret: one the World's application was issued (the credential door's), else one drawn from ctx.secret
  const signing = typeof b.signing_secret === 'string' ? b.signing_secret : b.app === true ? await appWebhookSecret(ctx) : `whsec_${Buffer.from(sha256(await ctx.secret(`webhook_secret:${draw}:${b.url}`)).slice(0, 48), 'hex').toString('base64')}`;
  const events = Array.isArray(b.events) ? (b.events as unknown[]).map(String) : [];
  const endpoint = await ctx.create('webhook_endpoint', { url: b.url, signing_secret: signing, ...(events.length ? { filter_types: events } : {}), created_at: ms(ctx) }, 'webhook_endpoint.create');
  return Response.json({ id: endpoint.id, url: b.url, events, signing_secret: signing }, { status: 201 });
}

/** POST /_twin/native-applications {platform: 'ios', app_id_prefix, bundle_id} | {platform: 'android', package_name,
 *  sha256_fingerprints}: "Add your iOS application to the Native applications page in the Clerk Dashboard"
 *  (https://clerk.com/docs/ios/getting-started/quickstart), the app kept for the instance. */
export async function nativeApplications(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const ios = b.platform === 'ios' && typeof b.app_id_prefix === 'string' && typeof b.bundle_id === 'string';
  const android = b.platform === 'android' && typeof b.package_name === 'string';
  if (!ios && !android) return Response.json({ error: 'an ios app needs app_id_prefix and bundle_id; an android app needs package_name' }, { status: 400 });
  const id = ctx.mint('_native_application');
  const fields = ios ? { platform: 'ios', app_id_prefix: b.app_id_prefix, bundle_id: b.bundle_id } : { platform: 'android', package_name: b.package_name, sha256_fingerprints: Array.isArray(b.sha256_fingerprints) ? b.sha256_fingerprints : [] };
  await ctx.record('_native_application', { ...fields, created_at: ms(ctx) }, id);
  return Response.json(fields, { status: 201 });
}

/** The instance's social connections after a change: each strategy an OAuth client (`{client_id}`), `false` removing it. */
function socialOf(held: unknown, given: Row): Record<string, { client_id: string; client_secret: string }> {
  const out: Record<string, { client_id: string; client_secret: string }> = { ...((held ?? {}) as Record<string, { client_id: string; client_secret: string }>) };
  for (const [strategy, value] of Object.entries(given)) {
    if (!/^oauth_[a-z0-9_]+$/.test(strategy)) continue;
    const v = value as Row | false | null;
    if (v === false) delete out[strategy];
    else if (v !== null && typeof v === 'object' && typeof v.client_id === 'string' && typeof v.client_secret === 'string') out[strategy] = { client_id: v.client_id, client_secret: v.client_secret };
  }
  return out;
}

/** POST /_twin/instance {password: 'off'|'on', legal_consent, frontend_api, organization_membership: 'optional'|'required',
 *  environment_type: 'development'|'production', native_api: true|false, application_name}: the application's
 *  name is the Dashboard's (clerk-js titles its cards with it); the User &
 *  authentication, Domains and Organizations Settings pages' settings, on the instance the Frontend API reads. */
export async function instance(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const existing = instanceRow(ctx);
  const held = (existing?._auth as Row | undefined) ?? {};
  const auth = {
    ...held,
    ...(b.password !== undefined ? { password: b.password === 'off' ? 'off' : 'on' } : {}),
    ...(b.legal_consent !== undefined ? { legal_consent: b.legal_consent === true } : {}),
    ...(typeof b.frontend_api === 'string' ? { frontend_api: b.frontend_api } : {}),
    ...(b.organization_membership === 'optional' || b.organization_membership === 'required' ? { organization_membership: b.organization_membership } : {}),
    ...(typeof b.native_api === 'boolean' ? { native_api: b.native_api } : {}),
    ...(b.social !== null && typeof b.social === 'object' ? { social: socialOf(held.social, b.social as Row) } : {}),
    ...(typeof b.application_name === 'string' && b.application_name.trim() !== '' ? { application_name: b.application_name.trim() } : {}),
  };
  await ctx.write('_instance', String(existing?.id ?? INSTANCE_SUBJECT), { object: 'instance', _auth: auth, ...(b.environment_type === 'production' || b.environment_type === 'development' ? { environment_type: b.environment_type } : {}) }, '_instance.update');
  return Response.json({ password: auth.password ?? 'on', legal_consent: auth.legal_consent ?? false, organization_membership: auth.organization_membership ?? 'required', native_api: auth.native_api === true });
}

/** The webhook signing secret the World's application is issued (`whsec_` and base64), drawn from ctx.secret. */
const appWebhookSecret = async (ctx: HandlerContext): Promise<string> => String((await webhookKey(ctx)).signing_secret);

/** POST /_twin/app-credentials: what the World's application holds, as the runtime issues it at every boot (the
 *  descriptor's credentialDoor), the same each time: the instance's secret key (the API Keys page's, kept by its
 *  SHA-256), its publishable key (the environment prefix and the base64 of its Frontend API host and `$`,
 *  https://clerk.com/docs/guides/development/clerk-environment-variables), the PEM public key a backend verifies session
 *  tokens with networklessly (`CLERK_JWT_KEY`, the API Keys page's "JWT public key"), and the signing secret of a
 *  instance webhook signing key (bound by the Webhooks door with `app: true`). */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const application = await applicationFor(ctx);
  const instance = await ctx.deploymentObject(`instance:${String(application.id)}`, '_instance', async (deployment) => {
    const held = instanceRow(ctx);
    if (held) return String(held.id);
    const frontend = await ctx.account() === 'default' && deployment === '' ? 'twin.clerk.accounts.dev' : `${String(application.id).replace(/_/g, '-').toLowerCase()}.clerk.accounts.dev`;
    const made = await ctx.createUnique('_instance', { object: 'instance', _application: application.id, environment_type: 'development', _auth: { frontend_api: frontend, application_name: application.name } }, '_instance.create');
    return String(made.row.id);
  });
  const secret = await ctx.accountKey('secret-key', '_secret_key', {
    make: () => makeSecretKey(ctx, ctx.deployment() || 'world'),
    read: (row) => row._instance === instance.id ? readSecretKey(ctx, row) : Promise.resolve(undefined),
  });
  const webhook = await ctx.accountKey('webhook-signing-key', '_webhook_signing_key', {
    make: async () => String((await webhookKey(ctx)).id),
    read: async (row) => row._instance === instanceId(ctx) && typeof row.signing_secret === 'string' ? row.signing_secret : undefined,
  });
  await ensureInstanceKey(ctx);
  return Response.json({ secret_key: secret.secret, publishable_key: publishableKey(ctx), jwt_key: instanceKey(ctx).publicPem.trim(), webhook_secret: webhook.secret }, { status: 201 });
}
