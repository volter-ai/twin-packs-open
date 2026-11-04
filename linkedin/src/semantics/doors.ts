// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"): what LinkedIn's own pages do
// that its API does not, each declared in the manifest's `doors`: signing up (linkedin.com/signup), creating a company
// page (Create a LinkedIn Page), the Developer Portal's Create app with its products, its OAuth Token Generator Tool,
// and the rate limits its app's Analytics tab shows; and the credential the World's application is issued.
import type { HandlerContext } from '@volter/world-core';
import { ACL, APP, USAGE, bodyOf, ensureApp, ensureMember, ensureOrganization, issueToken, memberOfEmail, PRODUCT_SCOPES, productsAllowed, refuse, makeApp, MEMBER, nowMs, TOKEN, tokenKey, tokenValue, view, type Row } from './shared.ts';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const bad = (message: string, status = 400): Response => refuse(status, message);

/** POST /_twin/members {email, password, given_name, family_name, headline?}: a member signs up. */
export async function members(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const [email, password, given, family] = [str(b.email), str(b.password), str(b.given_name), str(b.family_name)];
  if (!email || !password || !given || !family) return bad('email, password, given_name and family_name are required');
  const member = await ensureMember(ctx, { email, password, given_name: given, family_name: family, ...(str(b.headline) ? { headline: str(b.headline)! } : {}) });
  return Response.json({ sub: member.sub, person: `urn:li:person:${String(member.sub)}`, email: member.email }, { status: 201 });
}

/** POST /_twin/organizations {name, vanityName, admin, website?, description?, tagline?}: a member creates a company
 *  page and is its administrator. */
export async function organizations(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const [name, vanityName, admin] = [str(b.name), str(b.vanityName), str(b.admin)];
  if (!name || !vanityName || !admin) return bad('name, vanityName and admin (a member\'s email) are required');
  const member = memberOfEmail(ctx, admin);
  if (!member) return bad(`no member signed up as ${admin}`, 404);
  const row = await ensureOrganization(ctx, { name, vanityName, admin: member, ...(str(b.website) ? { website: str(b.website)! } : {}), ...(str(b.description) ? { description: str(b.description)! } : {}), ...(str(b.tagline) ? { tagline: str(b.tagline)! } : {}) });
  return Response.json({ ...view(ctx, row), urn: `urn:li:organization:${String(row.id)}` }, { status: 201 });
}

/** POST /_twin/developer-apps {name, products}: an application created on the Developer Portal, with its products. */
export async function developerApps(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const name = str(b.name);
  const products = Array.isArray(b.products) ? b.products.map(String) : [];
  if (!name || !products.length) return bad('name and products are required');
  const unknown = products.filter((p) => !PRODUCT_SCOPES[p]);
  if (unknown.length) return bad(`no such product: ${unknown.join(', ')}`);
  if (!productsAllowed(products)) return bad('the Community Management API is requested only for a new application with no other product');
  const { app, secret } = await ensureApp(ctx, name, products);
  return Response.json({ client_id: app.client_id, client_secret: secret, name: app.name, products: app.products, scopes: app.scopes }, { status: 201 });
}

/** POST /_twin/tokens {client_id, email, scopes}: the Developer Portal's OAuth Token Generator Tool, a member's token
 *  for the application with the scopes they approved. */
export async function tokens(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const app = ctx.row(APP, String(b.client_id ?? ''));
  if (!app) return bad('no such application', 404);
  const member = memberOfEmail(ctx, String(b.email ?? ''));
  if (!member) return bad('no such member', 404);
  const scopes = Array.isArray(b.scopes) ? b.scopes.map(String) : [];
  // source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow "Ensure that the permissions sent in scope parameter is assigned to the developer application in the LinkedIn developer portal."
  const outside = scopes.filter((s) => !(app.scopes as string[]).includes(s));
  if (!scopes.length || outside.length) return Response.json({ error: 'invalid_scope', error_description: `The requested permission scope is not valid: ${outside.join(' ') || '(none)'}` }, { status: 400 });
  return Response.json(await issueToken(ctx, app, member, scopes), { status: 201 });
}

/** POST /_twin/developer-apps/{clientId}/limits {resource, member?, application?, used?: {email, count}}: the daily
 *  limits the application's Analytics tab shows for an endpoint ("Standard rate limits are not published in
 *  documentation"), and, where the tab shows it, the calls a member has made through the application today outside this
 *  World (another deployment of the same application). */
export async function appLimits(ctx: HandlerContext): Promise<Response> {
  const app = ctx.row(APP, String(ctx.call.params.clientId ?? ''));
  if (!app) return bad('no such application', 404);
  const b = bodyOf(ctx);
  const resource = str(b.resource);
  const limit: Row = {};
  for (const k of ['member', 'application']) if (b[k] !== undefined) limit[k] = Number(b[k]);
  if (!resource || !Object.keys(limit).length || Object.values(limit).some((n) => !Number.isInteger(n) || Number(n) < 0)) return bad('resource and a whole member or application limit are required');
  const limits = { ...((app.limits as Row) ?? {}), [resource]: limit };
  await ctx.write(APP, String(app.client_id), { limits }, 'developer_app.limits');
  const used = b.used as Row | undefined;
  if (used !== undefined) {
    const member = memberOfEmail(ctx, String(used?.email ?? ''));
    const count = Number(used?.count);
    if (!member || !Number.isInteger(count) || count < 0) return bad('used names a member by email and a whole count');
    const day = ctx.occurredAt.slice(0, 10);
    // calls made are calls on all the application's APIs too, which the Development tier counts together (shared.ts spend)
    const spent = ((app.products as string[] | undefined) ?? []).includes('Community Management API') ? [resource, '*'] : [resource];
    for (const key of spent.flatMap((r) => [`${day}:${String(app.client_id)}:${String(member.sub)}:${r}`, `${day}:${String(app.client_id)}:*:${r}`])) {
      await ctx.record(USAGE, { count: Math.max(count, Number(ctx.row(USAGE, key)?.count ?? 0)) }, key);
    }
  }
  return Response.json({ client_id: app.client_id, limits });
}

/** A deployment's developer application, granted access by the organization's first member. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const explicit = b.account === undefined && b.deployment === undefined && (b.email !== undefined || b.client_id !== undefined);
  const member = explicit ? memberOfEmail(ctx, String(b.email ?? '')) : await ctx.tenant(MEMBER, async (organization) => {
    const email = organization.members[0]!.toLowerCase();
    const held = memberOfEmail(ctx, email);
    if (held) return String(held.id);
    const made = await ctx.createUnique(MEMBER, (id) => ({ sub: id, name: organization.label,
      given_name: organization.label, family_name: '', locale: 'en-US', email, email_verified: true, _email: email }), 'member.create');
    return String(made.row.id);
  });
  if (!member) return bad('no such member', 404);
  const app = explicit ? ctx.row(APP, String(b.client_id ?? ''))
    : await ctx.deploymentObject(`developer-app:${member.id}`, APP, async (deployment) => String((await makeApp(ctx, deployment || 'World App', ['Community Management API'], String(member.sub))).id));
  if (!app) return bad('no such application', 404);
  const token = await ctx.accountKey(explicit ? `member-grant:${app.client_id}:${member.sub}` : 'member-grant', TOKEN, {
    make: async () => {
      const grant = await issueToken(ctx, app, member, app.scopes as string[]);
      return tokenKey(ctx, grant.access_token);
    },
    read: async (row) => {
      if (row.client_id !== app.client_id || row.member !== member.sub || row.invalidated === true || Number(row.expires_at) <= nowMs(ctx) || typeof row._label !== 'string') return undefined;
      const value = await tokenValue(ctx, String(app.client_id), row._label);
      return tokenKey(ctx, value) === row.id ? value : undefined;
    },
  });
  const row = ctx.row(TOKEN, token.id)!;
  const organization = ctx.rowsRaw(ACL).find((acl) => acl.deleted !== true && acl.roleAssignee === `urn:li:person:${member.sub}` && acl.state === 'APPROVED')?.organization;
  return Response.json({ access_token: token.secret, expires_in: Math.floor((Number(row.expires_at) - nowMs(ctx)) / 1000),
    scope: (row.scopes as string[]).join(' '), client_id: app.client_id, person: `urn:li:person:${member.sub}`,
    ...(organization ? { organization } : {}) });
}
