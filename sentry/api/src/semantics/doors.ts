// The World's doors (architecture, "Doors, screens and the gap"): what sentry.io's pages do that its API does not, each
// declared in the manifest's `doors` and answered by the export its id names.
//
//   POST /_twin/app-credentials                     the application's DSN, auth token, organization and project (the
//                                                   descriptor's credentialDoor), the same at every boot
//   POST /_twin/organizations { slug, name? }       an organization (sentry.io's sign-up)
//   POST /_twin/auth-tokens { organization, name, kind?, scopes? }
//                                                   an organization auth token (Settings > Auth Tokens), or with kind
//                                                   personal a personal token with its scopes, shown once
import type { HandlerContext } from '@volter/world-core';
import { CLIENT_KEY, dsnOf, keyOf, makeClientKey, makeOrg, makeOrgToken, makePersonalToken, makeProject, orgBySlug, ORG, PROJECT, readToken, TOKEN } from './shared.ts';

const bad = (error: string): Response => Response.json({ error }, { status: 400 });
const bodyOf = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,49}$/;

/** The deployment's project client key and an independently issued auth token in its organization. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const b = bodyOf(ctx);
    const organizationId = await ctx.account();
    const org = await ctx.tenant(ORG, async (organization) => {
      const label = typeof b.organization === 'string' ? b.organization : organization.id === 'default' ? 'world' : organization.id;
      const rule = { max: 50, lower: true, allowed: /[a-z0-9_-]/, first: /[a-z0-9]/ };
      const name = typeof b.name === 'string' ? b.name : organization.label;
      let made = await makeOrg(ctx, ctx.vendorName(label, rule, { identity: organization.id }), name, organization.members[0]!);
      if (made instanceof Response) made = await makeOrg(ctx, ctx.vendorName(label, rule, { suffixed: true, identity: organization.id }), name, organization.members[0]!);
      if (made instanceof Response) throw await duplicate(made, organization.id);
      return String(made.id);
    });
    const project = await ctx.deploymentObject(`project:${String(org.id)}`, PROJECT, async (deployment) => {
      const label = typeof b.project === 'string' ? b.project : deployment || 'app';
      const identity = deployment === '' ? organizationId : `${organizationId}/${deployment}`;
      const rule = { max: Number.MAX_SAFE_INTEGER, lower: true, allowed: /[a-z0-9_-]/, first: /[a-z_-]/ };
      const platform = typeof b.platform === 'string' ? b.platform : 'javascript';
      let made = await makeProject(ctx, org, ctx.vendorName(label, rule, { identity }), platform);
      if (made instanceof Response) made = await makeProject(ctx, org, ctx.vendorName(label, rule, { suffixed: true, identity }), platform);
      if (made instanceof Response) throw await duplicate(made, identity);
      return String(made.id);
    });
    const key = await ctx.accountKey('client-key', CLIENT_KEY, {
      make: async () => String((keyOf(ctx, project) ?? await makeClientKey(ctx, org, project)).id),
      read: async (row) => row._project === project.id && row.isActive !== false && typeof row.public === 'string' ? row.public : undefined,
    });
    const token = await ctx.accountKey('auth-token', TOKEN, {
      make: async () => ctx.crypto.sha256(await makePersonalToken(ctx, org, ctx.deployment() || 'world-app', ['org:read', 'project:read', 'project:write', 'project:releases', 'event:read', 'alerts:read'])),
      read: (row) => readToken(ctx, org, row),
    });
    return Response.json({ dsn: dsnOf(org, project, { public: key.secret }), auth_token: token.secret, org: org.slug, org_id: org.id, project: project.slug }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

async function duplicate(response: Response, identity: string): Promise<Response> {
  const body = await response.json() as { slug: string[] };
  return Response.json({ slug: body.slug.map((message) => `${message} (${identity})`) }, { status: response.status });
}

export async function organizations(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.slug !== 'string' || !SLUG.test(b.slug)) return bad('a slug (lowercase letters, digits, - and _) is required');
  const org = await makeOrg(ctx, b.slug, typeof b.name === 'string' ? b.name : b.slug, (await ctx.organization()).members[0]!);
  if (org instanceof Response) return org;
  return Response.json({ id: org.id, slug: org.slug }, { status: 201 });
}

export async function authTokens(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const org = typeof b.organization === 'string' ? orgBySlug(ctx, b.organization) : undefined;
  if (!org) return bad('organization must name an organization the World holds');
  if (typeof b.name !== 'string' || !b.name) return bad('a name is required');
  const scopes = Array.isArray(b.scopes) ? b.scopes.map(String) : ['org:read', 'project:read', 'event:read'];
  return b.kind === 'personal' ? Response.json({ token: await makePersonalToken(ctx, org, String(b.name), scopes) }, { status: 201 }) : issueOrganizationToken(ctx, org, String(b.name));
}

async function issueOrganizationToken(ctx: HandlerContext, org: Record<string, unknown>, name: string): Promise<Response> {
  return Response.json({ token: await makeOrgToken(ctx, org, name) }, { status: 201 });
}
