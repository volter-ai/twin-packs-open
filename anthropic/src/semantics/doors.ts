// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: a person's Console sign-up (their organization and its Default workspace), and the mail the Console sent.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { issueKey, KEY, keyValue, liveKey, ORGANIZATION, type Row, WORKSPACE } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});

/** A person's Console sign-up: their organization, its Default workspace, and the person (who signs in by emailed
 *  code, so the password recorded is one no one holds). */
async function signUp(ctx: HandlerContext, email: string, organization: string): Promise<{ organization: string; workspace: string }> {
  const org = ctx.crypto.uuidFrom(`organization:${email}:${organization}`);
  await ctx.write(ORGANIZATION, org, { name: organization, admin: email, deleted: false }, 'organization.create');
  const ws = await ctx.create(WORKSPACE, { name: 'Default', organization: org, deleted: false }, 'workspace.create');
  await recordPerson(ctx, email, await ctx.secret(`console-login:${email}`), { organization: org, role: 'admin' });
  return { organization: org, workspace: String(ws.id) };
}

/** POST /_twin/users/{email} {organization}: a person who signed up to the Console, the admin of their new organization
 *  and its Default workspace. */
// source: https://platform.claude.com/docs/en/manage-claude/authentication "belongs to the workspace it was created in"
export async function users(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const b = bodyOf(ctx);
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || typeof b.organization !== 'string') return Response.json({ error: 'an email and an organization name are required' }, { status: 400 });
  const made = await signUp(ctx, email, b.organization);
  return Response.json({ email, ...made }, { status: 201 });
}

/** GET /_twin/mailbox/{email}: the mail the Console sent there, newest first. */
export async function mailbox(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const mail = ctx.rowsRaw('_mail').filter((m) => m.to === email).sort((a, b) => String(b.sent).localeCompare(String(a.sent)) || String(b.id).localeCompare(String(a.id))).map((m) => ({ subject: m.subject, text: m.text, sent: m.sent }));
  return Response.json({ mail });
}

/** POST /_twin/api-keys {email, organization?, name?}: a key made on the API keys page by that person, in their
 *  organization's Default workspace (the person and organization made first when new), never expiring; shown once. */
export async function keys(ctx: HandlerContext): Promise<Response> {
  return makeKey(ctx, bodyOf(ctx));
}

async function makeKey(ctx: HandlerContext, b: Row): Promise<Response> {
  const email = typeof b.email === 'string' ? b.email.toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return Response.json({ error: 'an email is required' }, { status: 400 });
  let org = ctx.rowsRaw(ORGANIZATION).find((o) => o.admin === email && o.deleted !== true);
  if (!org) {
    await signUp(ctx, email, typeof b.organization === 'string' ? b.organization : email);
    org = ctx.rowsRaw(ORGANIZATION).find((o) => o.admin === email && o.deleted !== true);
  }
  const workspace = ctx.rowsRaw(WORKSPACE).find((w) => w.organization === org?.id && w.name === 'Default' && w.deleted !== true);
  if (!org || !workspace) return Response.json({ error: 'no organization for that person' }, { status: 422 });
  return Response.json(await issueKey(ctx, String(org.id), String(workspace.id), email, typeof b.name === 'string' ? b.name : 'world', null), { status: 201 });
}

/** A deployment's workspace and its live API key, inside the customer's organization. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const organization = await ctx.tenant(ORGANIZATION, async org => {
    return String((await ctx.create(ORGANIZATION, { name: org.label, admin: org.members[0], deleted: false }, 'organization.create')).id);
  });
  const workspace = await ctx.deploymentObject(`workspace:${String(organization.id)}`, WORKSPACE, async deployment => {
    return String((await ctx.create(WORKSPACE, { name: deployment || 'Default', organization: organization.id, deleted: false }, 'workspace.create')).id);
  });
  const key = await ctx.accountKey('api-key', KEY, {
    make: async () => (await issueKey(ctx, String(organization.id), String(workspace.id), String(organization.admin), 'world', null)).id,
    read: async row => {
      if (row._organization !== organization.id || row.workspace !== workspace.id) return undefined;
      const value = await keyValue(ctx, String(row.id));
      return liveKey(ctx, value)?.id === row.id ? value : undefined;
    },
  });
  return Response.json({ id: key.id, key: key.secret }, { status: 201 });
}
