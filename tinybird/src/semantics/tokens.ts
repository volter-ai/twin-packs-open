// The Tokens API (https://www.tinybird.co/docs/api-reference/token-api): list, create a Static Token, read one, alter
// one's scopes, SQL row filters, name and description, and refresh. JWT issuance is a separate flow unused by the demand and life.
import type { HandlerContext } from '@volter/world-core';
import {
  answer, generationOf, getRow, hasScope, isKnownScope, listTokens, param, parseForm, parseScope, readOnlyRejection, retired, scopeView, storedToken, tbError, tokenKey, tokenOf,
  tokenValue, tokenView, write, wsOf,
} from './shared.ts';

// source: https://www.tinybird.co/docs/api-reference/token-api "All endpoints require authentication using a Token with TOKENS or ADMIN scope."
const NEEDS_TOKENS = 'token does not have the TOKENS scope';

/** The scopes a request sets, one `scope` per scope, in its query or its form body. */
const scopesOf = (body: string | undefined, query: URLSearchParams): string[] => [...new URLSearchParams(body ?? '').getAll('scope'), ...query.getAll('scope')];

/** GET /v0/tokens. */
export async function tokens(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    if (!hasScope(token, 'TOKENS')) return tbError(403, NEEDS_TOKENS);
    // source: https://www.tinybird.co/docs/api-reference/token-api "A list of your Static Tokens and their scopes will be sent in the response."
    return { status: 200, body: { tokens: listTokens(req).map(tokenView) } };
  });
}

/** POST /v0/tokens: a Static Token with its name and scopes. */
export async function create_token(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, query, token) => {
    if (!hasScope(token, 'TOKENS')) return tbError(403, NEEDS_TOKENS);
    // source: https://www.tinybird.co/docs/api-reference/token-api "If we provide an expiration_time in the URL, the token will be created as a JWT Token."
    if (query.get('expiration_time') !== null) return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
    if (req.readOnly) return readOnlyRejection();
    const form = parseForm(req.body);
    // source: https://www.tinybird.co/docs/api-reference/token-api "name String Name of the token"
    const name = form.name ?? query.get('name') ?? undefined;
    if (!name) return tbError(400, "You need to provide a value for 'name'");
    if (listTokens(req).some((t) => t.name === name)) return tbError(409, `Token '${name}' already exists`);
    // source: https://www.tinybird.co/docs/api-reference/token-api "Scope(s) to set. Format is SCOPE:TYPE[:arg][:filter] . This is only used for the Static Tokens"
    const scopes = scopesOf(req.body, query);
    if (scopes.length === 0) return tbError(400, "You need to provide at least one 'scope'");
    // a scope the Tokens page's table does not name is refused at create rather than stored and refused at first use
    const unknown = scopes.filter((sc) => !isKnownScope(sc));
    if (unknown.length > 0) return tbError(400, `Unknown scope(s): ${unknown.join(', ')}`);
    // a name used before (and deleted) is a new token: its value moves past every one the name has held
    const before = retired(req, tokenKey(name));
    const generation = before ? generationOf(before) + 1 : 0;
    const value = tokenValue(wsOf(req), name, generation, req.salt ?? '');
    // source: https://www.tinybird.co/docs/api-reference/token-api "Optional. Markdown text with a description of the token."
    const made = { name, token: value, scopes, description: form.description ?? query.get('description') ?? '' };
    await write('token', tokenKey(name), { ...storedToken(made, generation), deleted: false }, 'token.create', req);
    return { status: 200, body: tokenView(made) };
  });
}

/** GET /v0/tokens/<name>. */
export async function token_get(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    if (!hasScope(token, 'TOKENS')) return tbError(403, NEEDS_TOKENS);
    // source: https://www.tinybird.co/docs/api-reference/token-api "Fetches information about a particular Static Token."
    const name = param(ctx, 'token_id');
    const found = listTokens(req).find((t) => t.name === name);
    if (!found) return tbError(404, `Token '${name}' not found`);
    return { status: 200, body: tokenView(found) };
  });
}

/** PUT /v0/tokens/<name>: its scopes replaced (`tb push` grants a datafile's TOKEN so) and its description set. */
export async function alter_tokens(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, query, token) => {
    if (!hasScope(token, 'TOKENS')) return tbError(403, NEEDS_TOKENS);
    if (req.readOnly) return readOnlyRejection();
    const current = param(ctx, 'name');
    const form = parseForm(req.body);
    const rename = form.name ?? query.get('name') ?? undefined;
    // where the page stops: it does not say the admin token cannot be modified; the console offers no edit of it, and the
    // twin refuses one as the 403 the page gives a token's management
    if (current === 'admin token') return tbError(403, 'the admin token cannot be altered');
    const found = getRow('token', tokenKey(current), req);
    if (!found) return tbError(404, `Token '${current}' not found`);
    // source: https://www.tinybird.co/docs/api-reference/token-api "More than one scope can be sent per request, all of them will be added as Token scopes. Every time a Token scope is modified, it overrides the existing one(s)."
    const scopes = scopesOf(req.body, query);
    const unknown = scopes.filter((sc) => !isKnownScope(sc));
    if (unknown.length > 0) return tbError(400, `Unknown scope(s): ${unknown.join(', ')}`);
    const was = tokenOf(found);
    const altered = { ...was, scopes: scopes.length ? [...new Set(scopes)] : was.scopes, description: form.description ?? query.get('description') ?? was.description ?? '' };
    // source: https://www.tinybird.co/docs/api-reference/token-api "Name of the token"
    const name = rename ?? current;
    if (name !== current && getRow('token', tokenKey(name), req)) return tbError(409, `Token '${name}' already exists`);
    if (name !== current) await write('token', tokenKey(current), { deleted: true }, 'token.rename', req);
    await write('token', tokenKey(name), { ...storedToken({ ...altered, name }, generationOf(found)), deleted: false }, 'token.update', req);
    return { status: 200, body: { name, description: altered.description, scopes: altered.scopes.map((sc) => scopeView(sc)) } };
  });
}

/** POST /v0/tokens/<name>/refresh: a new value; the old one stops authenticating at once. */
export async function token_refresh(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, _query, token) => {
    if (!hasScope(token, 'TOKENS')) return tbError(403, NEEDS_TOKENS);
    if (req.readOnly) return readOnlyRejection();
    const name = param(ctx, 'token_id');
    const found = getRow('token', tokenKey(name), req);
    if (!found) return tbError(404, `Token '${name}' not found`);
    // source: https://www.tinybird.co/docs/api-reference/token-api "Refresh the Static Token without modifying name, scopes or any other attribute."
    const generation = generationOf(found) + 1;
    const refreshed = { ...tokenOf(found), token: tokenValue(wsOf(req), name, generation, req.salt ?? '') };
    await write('token', tokenKey(name), storedToken(refreshed, generation), 'token.refresh', req);
    return { status: 200, body: tokenView(refreshed) };
  });
}
