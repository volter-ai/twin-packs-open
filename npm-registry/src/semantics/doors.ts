// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap", in twin-world): what npmjs.com's
// pages do that the registry's API does not. Each answers only its own path under `/_twin/`.
//
//   POST /_twin/users { name, email, password }   a user (npmjs.com's sign-up page), with a publish token for it
//   POST /_twin/app-credentials                  the application's publish token (the descriptor's credentialDoor)
//   POST /_twin/orgs { name, owner }              an organization (npmjs.com's "create an organization" page), its
//                                                 owner a user the World holds
import type { HandlerContext } from '@volter/world-core';
import { issueToken, makeUser, ORG, readToken, TOKEN, USER } from './shared.ts';

const bad = (error: string): Response => Response.json({ error }, { status: 400 });
const objectBody = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {}) as Record<string, unknown>;


export async function users(ctx: HandlerContext): Promise<Response> {
  const b = objectBody(ctx);
  const name = typeof b.name === 'string' ? b.name : '';
  // an npm username: lowercase, url-safe, not starting with a dot or an underscore (npmjs.com's sign-up page)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || typeof b.email !== 'string' || typeof b.password !== 'string') return bad('name (lowercase, url-safe), email and password are required');
  if (ctx.row(USER, name)) return bad(`the user ${name} exists`);
  if (!await makeUser(ctx, name, b.email, b.password)) return bad(`the user ${name} exists`);
  const token = await issueToken(ctx, name, false, null, typeof b.expires === 'string' ? b.expires : undefined);
  return Response.json({ user: name, token: token.token }, { status: 201 });
}

export async function orgs(ctx: HandlerContext): Promise<Response> {
  const b = objectBody(ctx);
  const name = typeof b.name === 'string' ? b.name : '';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || typeof b.owner !== 'string') return bad('name (lowercase, url-safe) and owner are required');
  if (!ctx.row(USER, b.owner)) return bad(`no such user: ${b.owner}`);
  if (ctx.row(ORG, name) || ctx.row(USER, name)) return bad(`the scope @${name} is taken`);
  await ctx.write(ORG, name, { name, roster: { [b.owner]: 'owner' }, created: ctx.occurredAt }, 'org.create');
  return Response.json({ org: name, owner: b.owner }, { status: 201 });
}

/** A deployment's publish token, with its first member's native package and organization grants. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const user = await ctx.tenant(USER, async (organization) => {
      const email = organization.members[0]!.toLowerCase();
      const existing = ctx.rowsRaw(USER).find((row) => typeof row.email === 'string' && row.email.toLowerCase() === email);
      if (existing) return String(existing.name);
      const label = organization.id;
      const rule = { max: Number.MAX_SAFE_INTEGER, lower: true, allowed: /[a-z0-9._-]/, first: /[a-z0-9]/ };
      let made = await makeUser(ctx, ctx.vendorName(label, rule, { identity: organization.id }), email);
      if (!made) {
        const concurrent = ctx.rowsRaw(USER).find((row) => typeof row.email === 'string' && row.email.toLowerCase() === email);
        if (concurrent) return String(concurrent.name);
        made = await makeUser(ctx, ctx.vendorName(label, rule, { suffixed: true, identity: organization.id }), email);
      }
      if (!made) throw bad(`the user exists (${organization.id})`);
      return String(made.name);
    });
    const issued = await ctx.accountKey('access-token', TOKEN, {
      make: async () => String((await issueToken(ctx, String(user.name), false, null)).key),
      read: (row) => row.user === user.name ? readToken(ctx, row) : Promise.resolve(undefined),
    });
    return Response.json({ token: issued.secret }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
