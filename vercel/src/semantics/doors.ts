// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: a person's sign-up and their mail, the project a Git import made, and what a domain's owner does outside
// Vercel (their registrar's nameservers, a record at their DNS host), and an apex another Vercel account holds.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { EDGE_CONFIG, makeEdgeConfig, makeProject, makeTeam, makeToken, PROJECT, readToken, type Row, TEAM, TOKEN } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const bad = (error: string): Response => Response.json({ error }, { status: 400 });
async function duplicateFor(response: Response, identity: string): Promise<Response> {
  const refused = await response.json() as { error: Row };
  return Response.json({ error: { ...refused.error, message: `${String(refused.error.message)} (${identity})` } }, { status: response.status });
}

/** POST /_twin/users/{email} {team}: a person's account and their Pro team. Where the documentation stops: Vercel signs
 *  a person in by an emailed one-time password, so the account keeps no password of its own. */
export async function users(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const b = bodyOf(ctx);
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || typeof b.team !== 'string' || !/^[a-z0-9-]+$/.test(b.team)) return bad('an email and a team slug are required');
  // a password no one knows (drawn from ctx.secret): the person signs in by the emailed code
  await recordPerson(ctx, email, await ctx.secret(`no-password:${email}`));
  if (!ctx.rowsRaw(TEAM).some((t) => t.slug === b.team && t.deleted !== true)) {
    const made = await makeTeam(ctx, { slug: b.team, name: typeof b.name === 'string' ? b.name : b.team, owner: email });
    if (made instanceof Response) return made;
  }
  return Response.json({ email, team: b.team }, { status: 201 });
}

/** GET /_twin/mailbox/{email}: the mail Vercel sent the person, newest first. */
export async function mailbox(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  return Response.json({ mail: ctx.rowsRaw('_mail').filter((m) => m.to === email).reverse().map((m) => ({ to: m.to, subject: m.subject, text: m.text, sent: m.sent })) });
}

/** POST /_twin/projects {team, name}: the project Vercel made when the team imported its repository. */
export async function projects(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const team = ctx.rowsRaw(TEAM).find((t) => t.slug === b.team && t.deleted !== true);
  if (!team || typeof b.name !== 'string' || !/^[a-z0-9._-]{1,100}$/.test(b.name)) return bad('team (a slug) and name are required');
  const made = await makeProject(ctx, team, b.name);
  return made instanceof Response ? made : Response.json({ id: made.id, name: b.name }, { status: 201 });
}

/** POST /_twin/registrar/nameservers {domain, nameservers}: what the domain's owner set at their registrar. */
export async function nameservers(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.domain !== 'string' || !Array.isArray(b.nameservers)) return bad('domain and nameservers are required');
  await ctx.record('_nameservers', { domain: b.domain.toLowerCase(), nameservers: b.nameservers.map((n) => String(n).toLowerCase()), deleted: false }, b.domain.toLowerCase());
  return new Response(null, { status: 204 });
}

/** POST /_twin/dns {name, type, value}: a record the domain's owner set at their own DNS host. */
export async function dns(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const type = String(b.type ?? '').toUpperCase();
  if (typeof b.name !== 'string' || !['A', 'AAAA', 'CNAME', 'TXT', 'MX'].includes(type) || typeof b.value !== 'string') return bad('name, type and value are required');
  await ctx.record('_external_dns', { name: b.name.toLowerCase(), type, value: b.value, deleted: false }, `${b.name.toLowerCase()}::${type}`);
  return new Response(null, { status: 204 });
}

/** POST /_twin/claimed {domain}: an apex another Vercel account holds, so a project that adds it must verify it. */
export async function claimed(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.domain !== 'string') return bad('domain is required');
  await ctx.record('_claimed', { domain: b.domain.toLowerCase(), deleted: false }, b.domain.toLowerCase());
  return new Response(null, { status: 204 });
}

/** The organization's team, its deployment's project and connected Edge Config, and the project's access token. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const body = bodyOf(ctx);
    const organizationId = await ctx.account();
    const team = await ctx.tenant(TEAM, async (organization) => {
      const rule = { max: 48, lower: true, allowed: /[a-z0-9-]/ };
      const label = typeof body.team === 'string' ? body.team : organization.id === 'default' ? 'world' : organization.id;
      const name = typeof body.team === 'string' ? body.team : organization.label;
      const slug = ctx.vendorName(label, rule, { identity: organization.id });
      let made = await makeTeam(ctx, { slug, name, owner: organization.members[0]! });
      if (made instanceof Response) made = await makeTeam(ctx, { slug: ctx.vendorName(label, rule, { suffixed: true, identity: organization.id }), name, owner: organization.members[0]! });
      if (made instanceof Response) throw await duplicateFor(made, organization.id);
      return String(made.id);
    });
    const project = await ctx.deploymentObject(`project:${String(team.id)}`, PROJECT, async (deployment) => {
      const rule = { max: 100, lower: true, allowed: /[a-z0-9._-]/ };
      const label = typeof body.project === 'string' ? body.project : deployment || 'world';
      const identity = deployment === '' ? organizationId : `${organizationId}/${deployment}`;
      let made = await makeProject(ctx, team, ctx.vendorName(label, rule, { identity }));
      if (made instanceof Response) made = await makeProject(ctx, team, ctx.vendorName(label, rule, { suffixed: true, identity }));
      if (made instanceof Response) throw await duplicateFor(made, identity);
      return String(made.id);
    });
    const token = await ctx.accountKey('access-token', TOKEN, {
      make: () => makeToken(ctx, { name: String(project.name), team, expiresAt: null, project: String(project.id) }),
      read: (row) => row._team === team.id && row._project === project.id ? readToken(ctx, row) : Promise.resolve(undefined),
    });
    const config = await ctx.deploymentObject(`edge-config:${String(project.id)}`, EDGE_CONFIG, async () => {
      const deployment = ctx.deployment();
      const identity = deployment === '' ? organizationId : `${organizationId}/${deployment}`;
      const made = await makeEdgeConfig(ctx, team, ctx.vendorName(deployment || 'world', { max: 64, lower: true, allowed: /[a-z0-9_-]/ }, { identity }));
      await ctx.write(EDGE_CONFIG, String(made.id), { _project: project.name }, 'edge_config.connect');
      return String(made.id);
    });
    const read = await ctx.accountKey('edge-config-read', EDGE_CONFIG, {
      make: async () => String(config.id),
      read: async (row) => row.id === config.id && row.ownerId === team.id && row._project === project.name && typeof row._read_token === 'string' ? row._read_token : undefined,
    });
    return Response.json({ token: token.secret, team_id: team.id, project_id: project.id, edge_config: `https://edge-config.vercel.com/${String(config.id)}?token=${read.secret}`, edge_config_id: config.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
