// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: a person of the World's organization, who logs in to the dashboard with the password the World gave them.
import { personOf, recordPerson, type HandlerContext } from '@volter/world-core';
import { codexCredentials, credentialProject, epoch, makeProjectKey, nativeOrganization, organizationCodexCredentials, PROJECT_KEY, readProjectKey } from './shared.ts';

/** POST /_twin/accounts {email, name, password, role?} → 201 the person's user object (organization.user): the first is
 *  the organization's owner, every later one a reader, unless the call names the role. */
export async function accounts(ctx: HandlerContext): Promise<Response> {
  const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const taken = email !== '' && personOf(ctx, email) !== undefined;
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name || !password || taken || (body.role !== undefined && body.role !== 'owner' && body.role !== 'reader')) return invalidDoorRequest(taken ? `An account for ${email} already exists.` : 'An account needs an email address, a name and a password; a role is "owner" or "reader".');
  const organization = await nativeOrganization(ctx);
  const role = (body.role as 'owner' | 'reader' | undefined) ?? (ctx.rowsRaw('_person').some((p) => p.role === 'owner' && p._organization_id === organization.id) ? 'reader' : 'owner');
  // A user's id is `user-` and 24 base62 characters: the Admin API reference's list pages its users from `user-abc`, and
  // a real user's id, as an image URL of the DALL-E cookbook shows it, is that form (its other placeholder, user_abc, is
  // the reference's alone); derived from the person's address
  // source: https://developers.openai.com/api/reference/resources/organization/subresources/users/methods/list "user-abc"
  // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/dalle/Image_generations_edits_and_variations_with_DALL-E.ipynb "user-8OA8IvMYkfdAcUZXgzAXHS7d"
  const user = { id: `user-${ctx.crypto.base62From(`account:${email}`, 24)}`, object: 'organization.user', name, email, role, added_at: epoch(ctx) };
  await recordPerson(ctx, email, password, { user_id: user.id, name, role, added_at: user.added_at, _organization_id: organization.id });
  return Response.json(user, { status: 201 });
}

/** A deployment's API project key; the organization's subscription login is a separate credential lane. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const project = await credentialProject(ctx);
  if (project.status === 'archived') return ctx.refuse({ status: 400, message: 'Archived projects cannot be used or updated.' });
  const service = await ctx.deploymentObject(`service-account:${project.id}`, 'ProjectServiceAccount', async (deployment) =>
    String((await ctx.create('ProjectServiceAccount', { object: 'organization.project.service_account', name: deployment || 'world',
      _project_id: project.id, role: 'member', created_at: epoch(ctx),
    }, 'service_account.create')).id));
  const owner = { type: 'service_account', service_account: { id: service.id, name: service.name, role: service.role, created_at: service.created_at } };
  const key = await ctx.accountKey(`project-api-key:${project.id}`, PROJECT_KEY, {
    make: async () => {
      const prior = ctx.rowsRaw(PROJECT_KEY).find((row) => row.name === 'world' && row._project_id === project.id);
      if (prior && await readProjectKey(ctx, project, prior)) return String(prior.id);
      return makeProjectKey(ctx, project, ctx.deployment() || 'world', owner, 'all');
    },
    read: (row) => readProjectKey(ctx, project, row),
  });
  const body = ctx.body && typeof ctx.body === 'object' ? ctx.body as Record<string, unknown> : {};
  const subscription = body.account === undefined && body.deployment === undefined ? await codexCredentials(ctx) : await organizationCodexCredentials(ctx);
  return Response.json({ api_key: key.secret, project_id: project.id, ...subscription }, { status: 201 });
}

function invalidDoorRequest(message: string): Response {
  return Response.json({ error: { message, type: 'invalid_request_error' } }, { status: 400 });
}
