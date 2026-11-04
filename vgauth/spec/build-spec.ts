// The vendor publishes server source, not OpenAPI. This script reads the pinned dispatch and records its wire.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = import.meta.dir;
const source = readFileSync(`${dir}/recordings/worker-source.txt`, 'utf8');
const object = { type: 'object', additionalProperties: true };
const error = { type: 'object', required: ['error'], properties: { error: { type: 'string' } } };
const json = (schema = object) => ({ content: { 'application/json': { schema } } });
// Response shapes are the literal JSON values the pinned handlers construct. Provider token/proxy bodies are
// forwarded unchanged and therefore stay upstream-owned, rather than claiming a schema this server does not promise.
const str = { type: 'string' };
const num = { type: 'integer' };
const bool = { type: 'boolean' };
const array = (items: unknown) => ({ type: 'array', items });
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: true });
const domain = obj({ name: str, verified: bool, enrollmentMode: str });
const organization = obj({ id: str, name: str, slug: str, role: str, domains: array(domain) }, ['id', 'name', 'role', 'domains']);
const user = obj({ id: str, email: str, name: str }, ['id', 'email']);
const participant = obj({ id: str, email: str, name: str, organizations: array(organization) }, ['id', 'email', 'organizations']);
const shapes: Record<string, any> = {
  accountOAuthMetadata: obj({ issuer: str, authorization_endpoint: str, token_endpoint: str, response_types_supported: array(str), grant_types_supported: array(str), token_endpoint_auth_methods_supported: array(str), code_challenge_methods_supported: array(str), scopes_supported: array(str) }),
  accountProjection: { $ref: '#/components/schemas/Account' },
  collaborationVerify: obj({ userId: str }),
  collaborationHandoff: obj({ authorizationUrl: str, deliveryAuthorization: str, expiresAt: num }),
  collaborationInvitation: obj({ id: str, status: str, emailAddress: str }),
  collaborationRedeem: obj({ participant, jti: str, hostUserId: str }),
  inferenceGrant: obj({ grant: str, expiresAt: num }),
};
// source: recording:managed-account-app-source.txt "function accountSnapshot("
const account = { ...obj({ authenticated: bool, backend: str, user, organizations: array(organization),
  plan: obj({ id: str, name: str, status: { type: 'string', enum: ['free','active','cancelling','past_due'] }, interval: str, endsAt: str, renewsAt: str }, ['id','name','status']),
  credits: obj({ included: num, purchased: num, used: num, reserved: num, remaining: num, resetsAt: str, purchasedExpiresAt: str }, ['included','purchased','used','reserved','remaining']),
  spendPolicy: obj({ overageEnabled: bool, monthlyLimitCredits: num, alertThresholds: array(num), autoReload: object }, ['overageEnabled','monthlyLimitCredits','alertThresholds']),
  alerts: array(object), entitlements: obj({ generation: bool }) }, ['authenticated','backend','user','organizations','plan','credits','spendPolicy','entitlements']), 'x-resourceId': 'Account' };
const paths: Record<string, unknown> = {};
const served = new Set(['accountOAuthMetadata', 'accountAuthorize', 'accountCallback', 'accountToken', 'accountProjection', 'collaborationVerify', 'collaborationHandoff', 'collaborationInvitation', 'collaborationCallback', 'collaborationRedeem', 'inferenceGrant']);
for (const match of source.matchAll(/url.pathname === '([^']+)' && request.method === '(GET|POST)'\) \{\s*return (\w+)\(request, env\);/g)) {
  const [, path, method, id] = match;
  const tag = path!.startsWith('/account/') ? 'Account' : path!.startsWith('/collaboration/') ? 'Collaboration' : path!.startsWith('/v1/') ? 'Projection' : path!.startsWith('/inference/') ? 'Inference' : path!.startsWith('/.well-known/') ? 'Discovery' : 'Other';
  const statuses = ['collaborationHandoff', 'collaborationInvitation'].includes(id!) ? [201] : ['accountAuthorize', 'accountCallback', 'collaborationCallback'].includes(id!) ? [302] : [200];
  const responses: Record<string, unknown> = Object.fromEntries(statuses.map(status => [status, status === 302 ? { description: 'OAuth redirect', headers: { Location: { schema: { type: 'string' } } } } : { description: 'Vendor source response', ...json(shapes[id!] ?? object) }]));
  for (const status of [400,401,403,404,429,500,502,503]) responses[status] = { description: 'Vendor source refusal', ...json(error) };
  paths[path!] = { [method!.toLowerCase()]: { operationId: id, tags: [tag], summary: `${method} ${path}, dispatched to ${id} in the pinned Worker`, description: served.has(id!) ? 'The pinned vendor server source defines this operation.' : 'Outside the editor calls; the twin answers the gap.', responses } };
}
// source: recording:worker-source.txt "return clerkFrontendApiProxy(request, env);"
// worker.ts:111-112 dispatches this prefix without a method guard, before the OPTIONS preflight at line 120.
const proxyMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];
paths['/__clerk/{path}'] = Object.fromEntries(proxyMethods.map(method => [method, {
  // source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
  operationId: method === 'get' ? 'clerkFrontendApiProxy' : `clerkFrontendApiProxy${method[0]!.toUpperCase()}${method.slice(1)}`,
  tags: ['Proxy'], summary: `${method.toUpperCase()} through the same-site Clerk Frontend API proxy`,
  description: 'worker.ts:111-112 accepts the method without a guard; worker.ts:279 clones the incoming method, headers and body for Clerk.',
  parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
  // source: recording:worker-source.txt "const proxyRequest = new Request(upstream, request);"
  requestBody: { required: false, content: { '*/*': { schema: { type: 'string', format: 'binary' } } } },
  responses: { 200: { description: 'Clerk upstream response' }, 404: { description: 'Clerk upstream gap', ...json(error) }, 502: { description: 'Clerk proxy unavailable', ...json(error) }, 503: { description: 'Clerk proxy not configured', ...json(error) } },
}]));
writeFileSync(`${dir}/openapi.json`, JSON.stringify({ openapi:'3.0.3', info:{ title:'VGAI auth Worker', version:'8623e308'}, servers:[{url:'https://auth.videogame.ai'}],components:{schemas:{Account:account}},paths },null,2)+'\n');
