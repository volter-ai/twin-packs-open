import type { HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;

// source: https://platform.openai.com/docs/api-reference/project-api-keys
export async function nativeOrganization(ctx: HandlerContext): Promise<Row> {
  return ctx.tenant('_organization', async (world) => String((await ctx.create('_organization', {
    name: world.label, owner: world.members[0]!.toLowerCase(),
  }, 'organization.create')).id));
}

export async function credentialProject(ctx: HandlerContext): Promise<Row> {
  const organization = await nativeOrganization(ctx);
  const world = await ctx.account();
  return ctx.deploymentObject(`project:${organization.id}`, 'Project', async (deployment) => {
    if (world === 'default' && !deployment) {
      const existing = ctx.rowsRaw('Project').find((row) => row.name === 'Default project' && row.status !== 'archived' && row._organization_id === undefined);
      if (existing) {
        await ctx.write('Project', String(existing.id), { _organization_id: organization.id, _namespace: 'default' }, 'project.assign');
        return String(existing.id);
      }
    }
    return String((await ctx.create('Project', (id) => ({
      object: 'organization.project', name: world === 'default' && !deployment ? 'Default project' : deployment || organization.name,
      created_at: Math.floor(Date.parse(ctx.occurredAt) / 1000), archived_at: null, status: 'active',
      _organization_id: organization.id, _namespace: world === 'default' && !deployment ? 'default' : id,
    }), 'project.create')).id);
  });
}

/** API keys and signed media select a project. Codex grants are shared user-login custody. */
export async function tenant(ctx: HandlerContext): Promise<string> {
  const request = ctx.call.request, url = new URL(request.url);
  if (url.pathname === '/_twin/app-credentials') return String((await credentialProject(ctx))._namespace);
  const offered = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((part) => part.trim()).find((part) => part.startsWith('openai-insecure-api-key.'));
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? offered?.slice('openai-insecure-api-key.'.length);
  if (bearer) {
    const key = ctx.rowsRaw('ProjectApiKey', { withDeleted: true }).find((row) => row._sha256 === ctx.crypto.sha256(bearer));
    return (key?._project_namespace as string | undefined) ?? '__unselected__';
  }
  const projectId = /^\/settings\/(proj[-_][A-Za-z0-9_-]+)\/api-keys/.exec(url.pathname)?.[1];
  if (projectId) return (ctx.row('Project', projectId)?._namespace as string | undefined) ?? 'default';
  if (url.pathname.includes('/generated-images/')) {
    const id = url.pathname.split('/').pop()!.replace(/\.png$/, '');
    const image = ctx.rowsRaw('_generated_image').find((row) => row.id === id && row._sig === url.searchParams.get('sig'));
    return (image?._project_namespace as string | undefined) ?? '__unselected__';
  }
  return 'default';
}
