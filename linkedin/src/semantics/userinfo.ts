// Sign In with LinkedIn using OpenID Connect
// (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2): who a token's
// member is, at GET https://api.linkedin.com/v2/userinfo.
import type { HandlerContext } from '@volter/world-core';
import { accessDenied, callerOf, holds } from './shared.ts';

/** GET /v2/userinfo: the member's subject, names and locale, and their email where the token's scope asks for it. */
export async function userinfo(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  // source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 "In addition to the JWT received, you can also call userinfo endpoint to retrieve the member details."
  if (!holds(who, ['openid'])) return accessDenied('GET /v2/userinfo');
  const m = who.member;
  // source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 "The 'email' and 'email_verified' fields are optional and may not be included in all responses."
  const email = holds(who, ['email']) ? { email: m.email, email_verified: m.email_verified } : {};
  return Response.json({ sub: m.sub, name: m.name, given_name: m.given_name, family_name: m.family_name, locale: m.locale, ...email });
}
