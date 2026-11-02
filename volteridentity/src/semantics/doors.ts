// The World's doors (architecture, "Doors, screens and the gap"): what the identity service's operators and sign-up do
// outside its API, each declared in the manifest's `doors` and answered by the export its id names.
//
//   POST /_twin/users { email, name?, emailVerified? }         an existing emailed-code or passkey identity;
//                                                                        social identities use the provider callback
//   POST /_twin/shared-client                                            @volter/identity's shared public client, under
//                                                                        the id the package publishes (the admin API mints ids)
//   POST /_twin/app-credentials                                          the service's admin token (IDENTITY_ADMIN_TOKEN),
//                                                                        for the operator's account setup
//   POST /_twin/social { provider: github | google | apple, client_id, client_secret? }
//                                                                        the service's OAuth app at the provider (auth.ts:
//                                                                        GITHUB_CLIENT_ID and GOOGLE_CLIENT_ID with their
//                                                                        secrets), or for Apple the iOS apps whose Sign in
//                                                                        with Apple it accepts (APPLE_APP_IDS, no secret)
import type { HandlerContext } from '@volter/world-core';
import { adminToken, clientById, ID_TOKEN_PROVIDERS, PROVIDERS, registerClient, SHARED_CLIENT_ID, SOCIAL, USER, userByEmail } from './shared.ts';

const bad = (error: string): Response => Response.json({ error }, { status: 400 });
const bodyOf = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;

export async function social(ctx: HandlerContext): Promise<Response> { return configureProvider(ctx); }

async function configureProvider(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const apple = b.provider === 'apple';
  if (typeof b.provider !== 'string' || !(PROVIDERS[b.provider] || ID_TOKEN_PROVIDERS[b.provider]) || typeof b.client_id !== 'string' || (!apple && typeof b.client_secret !== 'string')) return bad('provider (github, google or apple), client_id and, but for apple, client_secret are required');
  await ctx.record(SOCIAL, { client_id: b.client_id, client_secret: apple ? null : b.client_secret }, b.provider);
  return Response.json({ provider: b.provider }, { status: 201 });
}

export async function users(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return bad('an email is required');
  const held = userByEmail(ctx, b.email);
  if (held) return Response.json({ id: held.id }, { status: 200 });
  // a Better Auth user id: 32 letters and digits, drawn by the World
  const id = ctx.mint(USER);
  await ctx.write(USER, id, { id, email: b.email.toLowerCase(), emailVerified: b.emailVerified !== false, name: typeof b.name === 'string' ? b.name : null, image: null, githubLogin: null, createdAt: ctx.occurredAt }, 'user.create');
  return Response.json({ id }, { status: 201 });
}

/** POST /_twin/shared-client: @volter/identity's shared client, which every Volter tool on a machine signs in with, as
 *  the service holds it: public (`token_endpoint_auth_method: none`), its redirect the loopback callback on any port,
 *  under the id the package publishes (`SHARED_CLIENTS`). The operator's API mints a client's id (`/admin/clients`), so
 *  only a door can make the client the package names; its resources are linked through the API like any client's. */
export async function sharedClient(ctx: HandlerContext): Promise<Response> {
  if (!clientById(ctx, SHARED_CLIENT_ID)) {
    await registerClient(ctx, SHARED_CLIENT_ID, undefined, {
      client_name: 'Volter', token_endpoint_auth_method: 'none', application_type: 'native', redirect_uris: ['http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'], scope: 'openid profile email offline_access', skip_consent: true,
    }, null);
  }
  return Response.json({ client_id: SHARED_CLIENT_ID }, { status: 201 });
}

/** POST /_twin/app-credentials: the service's admin token (IDENTITY_ADMIN_TOKEN), the operator's setting that no API
 *  reads, as the World holds it for account setup. A vendor-backed root uses the product's organizations token. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  return Response.json({ admin_token: await adminToken(ctx) });
}

/** The service's ISSUER binding, which has no vendor API: configure once before OAuth account setup. */
// source: recording:auth-source.txt "baseURL: issuer,"
export async function settings(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.ISSUER !== 'string') return bad('ISSUER must be an absolute HTTP or HTTPS URL');
  let url: URL;
  try { url = new URL(b.ISSUER); } catch { return bad('ISSUER must be an absolute HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return bad('ISSUER must be an absolute HTTP or HTTPS URL');
  const ISSUER = b.ISSUER.replace(/\/$/u, '');
  await ctx.record('_settings', { ISSUER }, 'service');
  return Response.json({ ISSUER });
}
