// The OAuth client reads the signed token headers and claims before using the returned credentials.
import { jwtDecode } from '@volter/world-core';
export const answerViews = {
  // The metrics CSV and member picker consume identities from a closed result set.
  userIds(body: unknown): unknown {
    return Array.isArray(body) ? body.map((row) => (row as Record<string, unknown>).id) : null;
  },
  oauthToken(body: unknown): unknown {
    const token = body as Record<string, unknown>;
    const access = jwtDecode(String(token.access_token));
    const id = token.id_token ? jwtDecode(String(token.id_token)) : undefined;
    return { ...access.payload, token_type: token.token_type, expires_in: token.expires_in, access_type: access.header.typ, id_type: id?.header.typ, id_claims: id?.payload };
  },
};
