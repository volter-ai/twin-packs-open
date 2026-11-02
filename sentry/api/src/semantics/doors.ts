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
import { dsnOf, heldOrgToken, keyOf, makeOrg, makeOrgToken, makePersonalToken, makeProject, orgBySlug, TOKEN } from './shared.ts';

const bad = (error: string): Response => Response.json({ error }, { status: 400 });
const bodyOf = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,49}$/;

/** Bootstrap (RECIPE, State): the account's sign-up creates its first credential and env-named project/key.
 *  The World's application: the organization `world`, its project `app`, the project's DSN and a token of the
 *  organization's, made the first time and answered the same at every boot: the token is re-derived from its secret and
 *  answered while it matches its hash; one revoked is not made again. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const account = await ctx.account();
  const slug = account === 'default' ? String(b.organization ?? 'world') : `world-${ctx.crypto.sha256(account).slice(0, 24)}`;
  const org = await makeOrg(ctx, slug, String(b.name ?? 'World'));
  const project = await makeProject(ctx, org, String(b.project ?? 'app'), String(b.platform ?? 'javascript'));
  const key = keyOf(ctx, project)!;
  const revoked = ctx.rowsRaw(TOKEN, { withDeleted: true }).some((t) => t.deleted === true && t.organization === org.id && t.name === 'world-app');
  if (revoked) return Response.json({ error: 'the application token was revoked' }, { status: 409 });
  const token = (await heldOrgToken(ctx, org, 'world-app')) ?? await makePersonalToken(ctx, org, 'world-app', ['org:read', 'project:read', 'project:write', 'project:releases', 'event:read', 'alerts:read']);
  return Response.json({ dsn: dsnOf(org, project, key), auth_token: token, org: org.slug, org_id: org.id, project: project.slug }, { status: 201 });
}

export async function organizations(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.slug !== 'string' || !SLUG.test(b.slug)) return bad('a slug (lowercase letters, digits, - and _) is required');
  const org = await makeOrg(ctx, b.slug, typeof b.name === 'string' ? b.name : b.slug);
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
