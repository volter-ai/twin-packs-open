import type { HandlerContext } from '@volter/world-core';
import { ORIGIN } from './shared.ts';
// source: recording:worker-source.txt "grant_types_supported: ['authorization_code', 'refresh_token'],"
export async function accountOAuthMetadata(ctx: HandlerContext): Promise<Response> {
  return ctx.reply({ issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/account/authorize`, token_endpoint: `${ORIGIN}/account/token`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['openid', 'profile', 'email', 'user:org:read'] });
}
