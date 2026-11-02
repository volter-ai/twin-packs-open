// The discovery document (worker/src/index.ts serves it at the root): the live document's fields
// (spec/recordings/2026-09-29-openid-configuration.json).
import type { HandlerContext } from '@volter/world-core';
import { authOf, issuerOf, SCOPES } from './shared.ts';

const SIGNING = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
const metadata = (ctx: HandlerContext) => ({
  scopes_supported: SCOPES, issuer: issuerOf(ctx), authorization_endpoint: `${authOf(ctx)}/oauth2/authorize`, token_endpoint: `${authOf(ctx)}/oauth2/token`, jwks_uri: `${authOf(ctx)}/jwks`,
  introspection_endpoint: `${authOf(ctx)}/oauth2/introspect`, revocation_endpoint: `${authOf(ctx)}/oauth2/revoke`, response_types_supported: ['code'], response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'], token_endpoint_auth_signing_alg_values_supported: SIGNING,
  introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'], introspection_endpoint_auth_signing_alg_values_supported: SIGNING,
  revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'], revocation_endpoint_auth_signing_alg_values_supported: SIGNING,
  code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true, dpop_signing_alg_values_supported: ['EdDSA', 'ES256', 'ES512', 'PS256', 'RS256'],
  backchannel_logout_supported: true, backchannel_logout_session_supported: true,
  claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'sid', 'scope', 'azp', 'name', 'picture', 'given_name', 'family_name', 'email', 'email_verified'], claims_parameter_supported: true,
  userinfo_endpoint: `${authOf(ctx)}/oauth2/userinfo`, subject_types_supported: ['public'], acr_values_supported: ['0'],
  id_token_signing_alg_values_supported: ['EdDSA'],
  end_session_endpoint: `${authOf(ctx)}/oauth2/end-session`, request_parameter_supported: false, request_uri_parameter_supported: false,
  prompt_values_supported: ['login', 'consent', 'create', 'select_account', 'none'], device_authorization_endpoint: `${authOf(ctx)}/device/code`,
});

// source: spec:openidConfiguration "The OpenID Connect discovery document"
export async function openidConfiguration(ctx: HandlerContext): Promise<Response> {
  return Response.json(metadata(ctx), { headers: { 'access-control-allow-origin': '*' } });
}

