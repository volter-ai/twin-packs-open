// OPENAI'S API KEYS PAGE — a workspace screen (docs/contributing/architecture.md, "Screens"): a project's secret keys
// are made on platform.openai.com, never through the API (docs: platform.openai.com/docs/api-reference/project-api-keys
// lists, retrieves and deletes them; creating one is the dashboard's "Create new secret key"). The page lists the
// project's keys, makes a new one from its name and permissions and shows its secret once, and revokes a key. The
// Admin API then reads and deletes what the page made. Authored from @volter/world-ui's portal piece under OpenAI's
// skin; nothing of OpenAI's page is copied.
//
// The page acts for the person signed in to the dashboard (./login.tsx), never on an API key: a key is for the API,
// and a request whose session names nobody is sent to log in. A key the page makes is that person's: its owner is
// their user (https://platform.openai.com/docs/api-reference/project-api-keys/object, owner.user: id, email, name,
// created_at, role).
//
// Where the documentation stops and the twin decides: a key's secret is derived from its id, and shown once, as the
// dashboard does; any person of the organization may make and revoke a project's keys.
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, toSignIn } from '@volter/world-ui';
import { sha256 } from '@volter/world-core';
import { epoch, mintProjectKey, PROJECT_KEY } from '../semantics/shared.ts';
import { PORTAL_PAGE_CSS, userOf, type User } from './shared.tsx';

// a key's owner as the spec's ProjectApiKeyOwnerUser gives it: the person's user, created_at being when they joined, and
// role their role in the project, "owner" or "member" (https://platform.openai.com/docs/api-reference/project-users/object).
// The twin keeps no project members: the organization's owner owns every project, and anyone else who makes a key there
// is a member of it.
const ownerOf = (user: User): Record<string, unknown> => ({ id: user.id, email: user.email, name: user.name, created_at: user.added_at, role: user.role === 'owner' ? 'owner' : 'member' });
const PERMISSIONS = [{ value: 'all', label: 'All' }, { value: 'restricted', label: 'Restricted' }, { value: 'read_only', label: 'Read only' }];
const redacted = (secret: string): string => `${secret.slice(0, 11)}...${secret.slice(-4)}`;

function page(ctx: HandlerContext, project: Record<string, unknown>, notice?: string, status = 200): Response {
  const id = String(project.id);
  const keys = ctx.rowsRaw(PROJECT_KEY).filter((k) => k._project_id === id).sort((a, b) => Number(b.created_at) - Number(a.created_at));
  const action = `/settings/${id}/api-keys`;
  return flowPage({
    title: 'API keys - OpenAI API',
    status,
    css: PORTAL_PAGE_CSS,
    body: (
      <Portal
        merchant="OpenAI Platform"
        back={{ href: '/settings/organization/general', label: String(project.name) }}
        {...(notice ? { notice } : {})}
        sections={[{
          heading: 'API keys',
          empty: 'This project has no API keys yet.',
          items: keys.map((k) => ({
            title: String(k.name),
            detail: String(k.redacted_value),
            note: `Created ${new Date(Number(k.created_at) * 1000).toISOString().slice(0, 10)} by ${String((k.owner as { user?: { name?: string } } | undefined)?.user?.name ?? '')}`,
            actions: [{ label: 'Revoke key', action, fields: { revoke: String(k.id) }, tone: 'danger' as const }],
          })),
        }]}
        forms={[{
          heading: 'Create new secret key',
          action,
          fields: [
            { id: 'name', label: 'Name', placeholder: 'My Test Key' },
            { id: 'permissions', label: 'Permissions', options: PERMISSIONS, value: 'all' },
          ],
          submit: { label: 'Create secret key' },
        }]}
      />
    ),
  });
}

/** platform.openai.com/settings/{project}/api-keys: the project's keys, a new one made (its secret shown once), a key
 *  revoked — for the person signed in. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const m = /^\/settings\/(proj[-_][A-Za-z0-9_-]+)\/api-keys\/?$/.exec(url.pathname);
  if (!m || (request.method !== 'GET' && request.method !== 'POST')) return new Response('Not Found', { status: 404 });
  const user = userOf(ctx);
  if (!user) return toSignIn('/login', url.pathname + url.search, 'return_to');
  const project = ctx.get('Project', m[1]!);
  if (!project) return flowPage({ title: 'OpenAI Platform', status: 404, css: PORTAL_PAGE_CSS, body: <main className="portal-main"><h1>Project not found</h1></main> });
  if (request.method === 'GET') return page(ctx, project);
  const form = formOf(ctx);
  if (form.revoke) {
    const key = ctx.row(PROJECT_KEY, form.revoke);
    if (!key || key._project_id !== project.id) return page(ctx, project, 'That key no longer exists.', 404);
    await ctx.write(PROJECT_KEY, form.revoke, { deleted: true }, 'api_key.delete');
    return page(ctx, project, `Revoked ${String(key.name)}. Requests using it will now fail.`);
  }
  const name = (form.name ?? '').trim() || 'Secret key';
  const id = ctx.mint(PROJECT_KEY);
  const secret = await mintProjectKey(ctx, id);
  await ctx.write(PROJECT_KEY, id, {
    object: 'organization.project.api_key', name, redacted_value: redacted(secret), created_at: epoch(ctx), last_used_at: null, _sha256: sha256(secret),
    _project_id: project.id, owner: { type: 'user', user: ownerOf(user) }, owner_project_access: 'active', _permissions: PERMISSIONS.some((p) => p.value === form.permissions) ? form.permissions : 'all',
  }, 'api_key.create');
  return page(ctx, project, `Save your key: ${secret}. You won't be able to view it again.`, 201);
}
