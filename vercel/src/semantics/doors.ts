// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: a person's sign-up and their mail, the project a Git import made, and what a domain's owner does outside
// Vercel (their registrar's nameservers, a record at their DNS host), and an apex another Vercel account holds.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { EDGE_CONFIG, PROJECT, type Row, TEAM, TOKEN } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const bad = (error: string): Response => Response.json({ error }, { status: 400 });

/** POST /_twin/users/{email} {team}: a person's account and their Pro team. Where the documentation stops: Vercel signs
 *  a person in by an emailed one-time password, so the account keeps no password of its own. */
export async function users(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const b = bodyOf(ctx);
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || typeof b.team !== 'string' || !/^[a-z0-9-]+$/.test(b.team)) return bad('an email and a team slug are required');
  // a password no one knows (drawn from ctx.secret): the person signs in by the emailed code
  await recordPerson(ctx, email, await ctx.secret(`no-password:${email}`));
  if (!ctx.rowsRaw(TEAM).some((t) => t.slug === b.team && t.deleted !== true)) {
    const id = `team_${ctx.mint('team')}`;
    const userId = ctx.mint('_user');
    await ctx.record('_user', { email: email }, userId);
    await ctx.write(TEAM, id, { id, slug: b.team, name: typeof b.name === 'string' ? b.name : b.team, billing: { plan: 'pro' }, avatar: null, description: null, stagingPrefix: String(b.team ?? 'world'), creatorId: userId, _userId: userId, updatedAt: Date.parse(ctx.occurredAt), createdAt: Date.parse(ctx.occurredAt), _owner: email, deleted: false }, 'team.create');
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
  const id = `prj_${ctx.mint('project')}`;
  await ctx.write(PROJECT, id, { id, name: b.name, accountId: team.id, framework: 'nextjs', alias: [], deploymentExpiration: {}, directoryListing: false, nodeVersion: '22.x', resourceConfig: {}, serverlessFunctionRegion: 'iad1', createdAt: Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), deleted: false }, 'project.create');
  return Response.json({ id, name: b.name }, { status: 201 });
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

/** POST /_twin/app-credentials {team?, project?}: what an application's environment needs from Vercel, as its owner makes
 *  it: the team and its project (the Git import's), an access token scoped to the team (Account Tokens, no expiration),
 *  and an Edge Config connected to the project (Storage), its connection string. The runtime issues these to a World's
 *  applications (the descriptor's credentialDoor). */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const account = await ctx.account();
  const suffix = account === 'default' ? '' : `-${ctx.crypto.sha256(account).slice(0, 24)}`;
  const slug = `${typeof b.team === 'string' ? b.team : 'world'}${suffix}`;
  const owner = account === 'default' ? 'owner@world.test' : `owner+${ctx.crypto.sha256(account).slice(0, 24)}@world.test`;
  let team = ctx.rowsRaw(TEAM).find((t) => t.slug === slug && t.deleted !== true);
  if (!team) {
    await recordPerson(ctx, owner, await ctx.secret(`no-password:${owner}`));
    const id = `team_${ctx.mint('team')}`;
    const userId = ctx.mint('_user');
    await ctx.record('_user', { email: owner }, userId);
    await ctx.write(TEAM, id, { id, slug, name: slug, billing: { plan: 'pro' }, avatar: null, description: null, stagingPrefix: String(b.team ?? 'world'), creatorId: userId, _userId: userId, updatedAt: Date.parse(ctx.occurredAt), createdAt: Date.parse(ctx.occurredAt), _owner: owner, deleted: false }, 'team.create');
    team = ctx.rowsRaw(TEAM).find((t) => t.id === id)!;
  }
  const projectName = typeof b.project === 'string' ? b.project : 'world';
  let project = ctx.rowsRaw(PROJECT).find((p) => p.name === projectName && p.accountId === team!.id && p.deleted !== true);
  if (!project) {
    const id = `prj_${ctx.mint('project')}`;
    await ctx.write(PROJECT, id, { id, name: projectName, accountId: team.id, framework: 'nextjs', alias: [], deploymentExpiration: {}, directoryListing: false, nodeVersion: '22.x', resourceConfig: {}, serverlessFunctionRegion: 'iad1', createdAt: Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), deleted: false }, 'project.create');
    project = ctx.rowsRaw(PROJECT).find((p) => p.id === id)!;
  }
  // the application's token and edge config, made the first time the runtime asks and the same at every boot after
  // (a token's value is its id's)
  // a held key answers again only while its value still matches what is stored (a branch that made its own seed before
  // the key reached it derives another value, so it issues a new key rather than one that is refused)
  const found = ctx.rowsRaw(TOKEN).find((t) => t.name === 'world' && t._team === team!.id && t.deleted !== true);
  const heldToken = found && found._sha256 === ctx.crypto.sha256((await ctx.secret(`vercel-token:${String(found.id)}`)).replace(/[-_]/g, '').slice(0, 24)) ? found : undefined;
  const tokenId = heldToken ? String(heldToken.id) : ctx.mint('_token');
  const token = (await ctx.secret(`vercel-token:${tokenId}`)).replace(/[-_]/g, '').slice(0, 24);
  if (!heldToken) await ctx.record(TOKEN, { name: 'world', _owner: team._owner, _team: team.id, _teamSlug: team.slug, _sha256: ctx.crypto.sha256(token), createdAt: Date.parse(ctx.occurredAt), expiresAt: null, deleted: false }, tokenId);
  const heldConfig = ctx.rowsRaw(EDGE_CONFIG).find((e) => e.slug === 'world' && e.ownerId === team!.id && e.deleted !== true);
  const ecfg = heldConfig ? String(heldConfig.id) : `ecfg_${ctx.mint('edge_config')}`;
  const read = ctx.crypto.uuidFrom(await ctx.secret(`edge-config-read:${ecfg}`));
  if (!heldConfig) await ctx.write(EDGE_CONFIG, ecfg, { id: ecfg, slug: 'world', ownerId: team.id, digest: ctx.crypto.digest('sha256', '[]').slice(0, 32), itemCount: 0, sizeInBytes: 2, createdAt: Date.parse(ctx.occurredAt), updatedAt: Date.parse(ctx.occurredAt), _read_token: read, _project: project.name, deleted: false }, 'edge_config.create');
  return Response.json({ token, team_id: team.id, project_id: project.id, edge_config: `https://edge-config.vercel.com/${ecfg}?token=${read}`, edge_config_id: ecfg }, { status: 201 });
}
