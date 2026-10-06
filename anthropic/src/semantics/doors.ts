// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: a person's Console sign-up (their organization and its Default workspace), and the mail the Console sent.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { KEY, keyValue, ORGANIZATION, type Row, WORKSPACE } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});

/** A person's Console sign-up: their organization, its Default workspace, and the person (who signs in by emailed
 *  code, so the password recorded is one no one holds). */
async function signUp(ctx: HandlerContext, email: string, organization: string): Promise<{ organization: string; workspace: string }> {
  const org = ctx.crypto.uuidFrom(`organization:${email}:${organization}`);
  await ctx.write(ORGANIZATION, org, { name: organization, admin: email, deleted: false }, 'organization.create');
  const ws = `wrkspc_01${ctx.mint(WORKSPACE)}`;
  await ctx.write(WORKSPACE, ws, { name: 'Default', organization: org, deleted: false }, 'workspace.create');
  await recordPerson(ctx, email, await ctx.secret(`console-login:${email}`), { organization: org, role: 'admin' });
  return { organization: org, workspace: ws };
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
  const id = `apikey_01${ctx.mint(KEY)}`;
  const value = await keyValue(ctx, id);
  await ctx.write(KEY, id, { name: typeof b.name === 'string' ? b.name : 'world', workspace: workspace.id, _organization: org.id, created_by: email, created_at: ctx.occurredAt, hint: `${value.slice(0, 14)}...${value.slice(-4)}`, _sha256: ctx.crypto.sha256(value), expires_at: null, status: 'active', deleted: false }, 'api_key.create');
  return Response.json({ id, key: value }, { status: 201 });
}

/** POST /_twin/app-credentials: the key the World's application holds (the descriptor's credentialDoor), a key "world" of
 *  owner@world.test's organization: made the first time the runtime asks and the same at every boot after. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  // a held key answers again only while its value still matches what is stored (a branch that made its own seed before
  // the key reached it derives another value, so it issues a new key rather than one that is refused)
  const held = ctx.rowsRaw(KEY).find((k) => k.name === 'world' && k.created_by === 'owner@world.test' && k.status === 'active' && k.deleted !== true);
  const again = held ? await keyValue(ctx, String(held.id)) : undefined;
  if (held && again && held._sha256 === ctx.crypto.sha256(again)) return Response.json({ id: held.id, key: again }, { status: 201 });
  return makeKey(ctx, { email: 'owner@world.test', organization: 'World', name: 'world' });
}
