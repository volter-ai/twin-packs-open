import type { HandlerContext } from '@volter/world-core';

import { credentialProject } from './shared.ts';

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
