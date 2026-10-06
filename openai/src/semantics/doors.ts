// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: a person of the World's organization, who logs in to the dashboard with the password the World gave them.
import { personOf, recordPerson, sha256, type HandlerContext } from '@volter/world-core';
import { codexCredentials, epoch, mintProjectKey, PROJECT_KEY } from './shared.ts';

/** POST /_twin/accounts {email, name, password, role?} → 201 the person's user object (organization.user): the first is
 *  the organization's owner, every later one a reader, unless the call names the role. */
export async function accounts(ctx: HandlerContext): Promise<Response> {
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const taken = email !== '' && personOf(ctx, email) !== undefined;
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name || !password || taken || (body.role !== undefined && body.role !== 'owner' && body.role !== 'reader')) return invalidDoorRequest(taken ? `An account for ${email} already exists.` : 'An account needs an email address, a name and a password; a role is "owner" or "reader".');
  const role = (body.role as 'owner' | 'reader' | undefined) ?? (ctx.rowsRaw('_person').some((p) => p.role === 'owner') ? 'reader' : 'owner');
  // A user's id is `user-` and 24 base62 characters: the Admin API reference's list pages its users from `user-abc`, and
  // a real user's id, as an image URL of the DALL-E cookbook shows it, is that form (its other placeholder, user_abc, is
  // the reference's alone); derived from the person's address
  // source: https://developers.openai.com/api/reference/resources/organization/subresources/users/methods/list "user-abc"
  // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/dalle/Image_generations_edits_and_variations_with_DALL-E.ipynb "user-8OA8IvMYkfdAcUZXgzAXHS7d"
  const user = { id: `user-${ctx.crypto.base62From(`account:${email}`, 24)}`, object: 'organization.user', name, email, role, added_at: epoch(ctx) };
  await recordPerson(ctx, email, password, { user_id: user.id, name, role, added_at: user.added_at });
  return Response.json(user, { status: 201 });
}

/** POST /_twin/app-credentials: the key an application holds, made on the Default project's API keys page (the project
 *  made first when the organization has none), shown once. The runtime issues it to a World's applications (the
 *  descriptor's credentialDoor). */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  let project = ctx.rowsRaw('project').find((p) => p.name === 'Default project' && p.deleted !== true);
  if (!project) {
    const id = ctx.mint('Project');
    await ctx.write('Project', id, { object: 'organization.project', name: 'Default project', created_at: epoch(ctx), archived_at: null, status: 'active' }, 'project.create');
    project = ctx.rowsRaw('project').find((p) => p.id === id)!;
  }
  // the application's key, made the first time the runtime asks and the same at every boot after (its value is its id's)
  // a held key answers again only while its value still matches what is stored (a branch that made its own seed before
  // the key reached it derives another value, so it issues a new key rather than one that is refused)
  const held = ctx.rowsRaw(PROJECT_KEY).find((k) => k.name === 'world' && k._project_id === project!.id && k.deleted !== true);
  const again = held ? await mintProjectKey(ctx, String(held.id)) : undefined;
  if (held && again && held._sha256 === sha256(again)) return Response.json({ api_key: again, project_id: project.id, ...await codexCredentials(ctx) }, { status: 201 });
  const id = ctx.mint(PROJECT_KEY);
  const secret = await mintProjectKey(ctx, id);
  await ctx.write(PROJECT_KEY, id, { object: 'organization.project.api_key', name: 'world', redacted_value: `sk-proj-****${secret.slice(-4)}`, created_at: epoch(ctx), last_used_at: null, _sha256: sha256(secret), _project_id: project.id, owner: { type: 'user', user: null }, owner_project_access: 'active', _permissions: 'all' }, 'api_key.create');
  return Response.json({ api_key: secret, project_id: project.id, ...await codexCredentials(ctx) }, { status: 201 });
}

function invalidDoorRequest(message: string): Response {
  return Response.json({ error: { message, type: 'invalid_request_error' } }, { status: 400 });
}
