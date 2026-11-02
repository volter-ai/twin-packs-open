// The operator's registration routes (worker/src/index.ts): "Products are registered by us (ADR-0001 §3): the only door
// to Better Auth's server-only client registration, behind the service's admin token." Every one acts as the signed-in
// person as well as by the admin token: without a session it says so first, then without the token it is unauthorized.
// The request and its refusals are Better Auth's admin endpoints' (@better-auth/oauth-provider 1.7.5).
import type { HandlerContext } from '@volter/world-core';
import { adminToken, clientById, CLIENT, live, organizationsOf, registerClient, RESOURCE, type Row, sessionUser, serial } from './shared.ts';

const body = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? ctx.body as Row : {});
const json = (b: unknown, status = 200): Response => Response.json(b, { status, headers: { 'cache-control': 'no-store' } });
const refused = (status: number, error: string, description?: string): Response => json(description === undefined ? { error } : { error, error_description: description }, status);
const GRANTS = ['authorization_code', 'client_credentials', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'];
const AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'];

/** The operator: a signed-in person presenting the service's admin token; else the refusal index.ts answers. */
async function operator(ctx: HandlerContext): Promise<Row | Response> {
  const person = sessionUser(ctx);
  // source: spec:/paths/~1admin~1clients/post/responses/401/description "sign in to id.volter.ai first; the admin routes act as the signed-in person"
  if (!person) return refused(401, 'sign in to id.volter.ai first; the admin routes act as the signed-in person');
  if ((ctx.call.request.headers.get('authorization') ?? '') !== `Bearer ${await adminToken(ctx)}`) return refused(401, 'unauthorized');
  return person;
}

/** A redirect a client may register: https for a web client; a native one also a loopback http address or its own
 *  scheme (identity's world scripts: "the service admits a loopback http redirect only for native clients"). */
function redirectOk(uri: string, type: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (type !== 'native') return false; return u.protocol === 'http:' ? ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) : nativeScheme(u.protocol);
}

/** `POST /admin/clients`: a product registered, its id and (for a confidential client) its secret answered once. */
// source: spec:adminCreateClient "A product registered by the operator"
export async function adminCreateClient(ctx: HandlerContext): Promise<Response> {
  const who = await operator(ctx); if (who instanceof Response) return who;
  const b = body(ctx);
  const method = typeof b.token_endpoint_auth_method === 'string' ? b.token_endpoint_auth_method : 'client_secret_basic';
  // where the twin stops: private_key_jwt clients (a client's own JWKS) are not modelled; no product registers one
  if (!AUTH_METHODS.includes(method)) return refused(400, 'invalid_client_metadata', `unsupported token_endpoint_auth_method ${method}`);
  const type = typeof b.application_type === 'string' ? b.application_type : 'web';
  if (type !== 'web' && type !== 'native') return refused(400, 'invalid_client_metadata', 'application_type must be web or native');
  const grantTypes = Array.isArray(b.grant_types) ? b.grant_types.map(String) : ['authorization_code'];
  if (grantTypes.length === 0) return refused(400, 'invalid_client_metadata', 'grant_types must contain at least one grant type');
  for (const g of grantTypes) if (!GRANTS.includes(g)) return refused(400, 'invalid_client_metadata', `unsupported grant_type ${g}`);
  const redirects = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  // source: spec:/paths/~1admin~1clients/post/responses/400/description "Better Auth's refusal of the client's metadata (invalid_client_metadata, invalid_redirect_uri)"
  if (grantTypes.includes('authorization_code') && redirects.length === 0) return refused(400, 'invalid_redirect_uri', 'Redirect URIs are required for authorization_code and implicit grant types');
  for (const r of redirects) if (!redirectOk(r, type)) return refused(400, 'invalid_redirect_uri', `invalid redirect_uri ${r}`);
  const responseTypes = Array.isArray(b.response_types) ? b.response_types.map(String) : grantTypes.includes('authorization_code') ? ['code'] : [];
  if (grantTypes.includes('authorization_code') && !responseTypes.includes('code')) return refused(400, 'invalid_client_metadata', "When 'authorization_code' grant type is used, 'code' response type must be included");
  const ccScopes = Array.isArray(b.client_credentials_scopes) ? b.client_credentials_scopes.map(String) : [];
  if (ccScopes.length > 0 && (!grantTypes.includes('client_credentials') || method === 'none')) return refused(400, 'invalid_client_metadata', 'client_credentials_scopes require a confidential client with the client_credentials grant');
  // Better Auth's client id and secret: 32 random letters each, drawn here from a secret the World holds (ctx.secret)
  const n = await serial(ctx, 'client');
  const clientId = ctx.crypto.lettersFrom(await ctx.secret(`volteridentity:client-id:${n}`), 32);
  const secret = method === 'none' ? undefined : ctx.crypto.lettersFrom(await ctx.secret(`volteridentity:client-secret:${clientId}`), 32);
  const row = await registerClient(ctx, clientId, secret, { ...b, token_endpoint_auth_method: method, application_type: type, grant_types: grantTypes, response_types: responseTypes, client_credentials_scopes: ccScopes }, String(who.id));
  return json({
    client_id: clientId, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), ...(row.scope ? { scope: row.scope } : {}),
    user_id: who.id, client_id_issued_at: row.client_id_issued_at, ...(row.client_name ? { client_name: row.client_name } : {}), ...(row.logo_uri ? { logo_uri: row.logo_uri } : {}),
    redirect_uris: row.redirect_uris, token_endpoint_auth_method: method, grant_types: grantTypes, response_types: responseTypes, application_type: type,
    ...(b.skip_consent !== undefined ? { skip_consent: row.skip_consent } : {}), client_credentials_scopes: ccScopes,
  }, 201);
}

/** `POST /admin/resources`: a product's origin, or the service's own organizations door, as a resource. */
// source: spec:adminCreateResource "A product's API that access tokens may name as their audience (RFC 8707)"
export async function adminCreateResource(ctx: HandlerContext): Promise<Response> {
  const who = await operator(ctx); if (who instanceof Response) return who;
  const { identifier, name } = body(ctx) as { identifier?: unknown; name?: unknown };
  // source: spec:/paths/~1admin~1resources/post/responses/400/description "identifier must be an https origin"
  if (typeof identifier !== 'string' || (identifier !== organizationsOf(ctx) && !/^https:\/\/[^/]+$/u.test(identifier))) return refused(400, 'identifier must be an https origin');
  if (live(ctx.row(RESOURCE, identifier))) return refused(400, 'invalid_request', `resource ${identifier} already exists`);
  const row = { identifier, name: typeof name === 'string' ? name : identifier, accessTokenTtl: null, refreshTokenTtl: null, signingAlgorithm: null, signingKeyId: null, allowedScopes: null, customClaims: null, dpopBoundAccessTokensRequired: false, disabled: false, policyVersion: 1, metadata: null, createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt };
  await ctx.record(RESOURCE, row, identifier);
  return json(row, 201);
}

/** `POST /admin/clients/{client_id}/resources { resource }`: a client linked to a resource its tokens may name. */
// source: spec:adminLinkClientResource "A registered product linked to the resource its access tokens are for (RFC 8707)"
export async function adminLinkClientResource(ctx: HandlerContext): Promise<Response> {
  const who = await operator(ctx); if (who instanceof Response) return who;
  const resource = body(ctx).resource;
  // source: spec:/paths/~1admin~1clients~1{client_id}~1resources/post/responses/400/description "a resource is required"
  if (typeof resource !== 'string' || !resource) return refused(400, 'a resource is required');
  // the organizations door is one of the service's configured resources (auth.ts `resources`); any other is registered
  // source: spec:/paths/~1admin~1clients~1{client_id}~1resources/post/responses/404/description "the resource or the client is not found"
  if (resource !== organizationsOf(ctx) && !live(ctx.row(RESOURCE, resource))) return refused(404, 'not_found', `resource ${resource} not found`);
  const clientId = String(ctx.call.params.client_id);
  const client = clientById(ctx, clientId);
  if (!client) return refused(404, 'not_found', `client ${clientId} not found`);
  const held = (client.resources as string[] | undefined) ?? [];
  if (held.includes(resource)) return json({ linked: true, alreadyLinked: true }, 201);
  await ctx.write(CLIENT, clientId, { resources: [...held, resource] }, 'oauth_client.link_resource');
  return json({ linked: true }, 201);
}

/** Native clients may register a private-use URI; reserved schemes are refused. */
// source: https://www.better-auth.com/docs/plugins/oauth-provider "malformed or reserved schemes such as file: and mailto:"
function nativeScheme(protocol: string): boolean {
  return !['file:', 'ftp:', 'mailto:', 'javascript:', 'data:', 'vbscript:'].includes(protocol);
}
