// OAuth application registration is account setup; browser grants use this same stored vendor object.
import type { HandlerContext } from '@volter/world-core';
import { body, CLERK_INSTANCE_ID, invalid, issuerOf, missing, ms, sha256 } from './shared.ts';

// source: spec:CreateOAuthApplication "Creates a new OAuth application with the given name and callback URL for an instance."
export async function CreateOAuthApplication(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  if (typeof b.name !== 'string' || !b.name) return missing('name');
  if (b.name.length > 256) return invalid('name', 'name must be at most 256 characters.');
  // source: spec:CreateOAuthApplication "All URL schemes are allowed"
  const redirects = b.redirect_uris ?? (b.callback_url ? [b.callback_url] : []);
  if (!Array.isArray(redirects) || redirects.some((v) => typeof v !== 'string' || !URL.canParse(v))) return invalid('redirect_uris', 'redirect_uris must contain valid URLs.');
  // Device authorization is a separate flow outside the worker demand; the vendor documents no gap message for enabling it here.
  if (b.device_authorization_grant_enabled === true) return invalid('device_authorization_grant_enabled', 'Device authorization is not served.');
  const id = ctx.mint('OAuthApplication');
  // The spec gives no client-id width. Draw credentials from the World secret, never from public ids alone.
  const clientId = ctx.crypto.base62From(await ctx.secret(`oauth-client:${id}`), 16);
  const secret = b.public === true ? '' : ctx.crypto.base62From(await ctx.secret(`oauth-secret:${id}`), 48);
  const issuer = issuerOf(ctx);
  // source: spec:/components/schemas/OAuthApplication "oauth_application"
  await ctx.write('OAuthApplication', id, {
    id, object: 'oauth_application', instance_id: CLERK_INSTANCE_ID, name: b.name, client_id: clientId,
    client_uri: null, client_image_url: null, dynamically_registered: false,
    consent_screen_enabled: b.consent_screen_enabled !== false, pkce_required: b.pkce_required === true,
    device_authorization_grant_enabled: false, public: b.public === true,
    scopes: typeof b.scopes === 'string' ? b.scopes : 'profile email', redirect_uris: redirects,
    callback_url: redirects[0] ?? '', authorize_url: `${issuer}/oauth/authorize`, token_fetch_url: `${issuer}/oauth/token`,
    user_info_url: `${issuer}/oauth/userinfo`, discovery_url: `${issuer}/.well-known/openid-configuration`,
    token_introspection_url: `${issuer}/oauth/token_info`, created_at: ms(ctx), updated_at: ms(ctx),
  }, 'oauth_application.create');
  if (secret) await ctx.record('_oauth_client_secret', { sha256: sha256(secret) }, clientId);
  // source: spec:/components/schemas/OAuthApplicationWithSecret "Empty if public client."
  return ctx.reply({ ...ctx.get('OAuthApplication', id), client_secret: secret });
}
