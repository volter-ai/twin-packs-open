// Scoped API authentication and the vendor's organization/project/monitor slug resolution.
import type { HandlerContext } from '@volter/world-core';
import { bearerToken, detail, forbidden, grants, orgFor, projectFor, MONITOR } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  if (!new URL(request.url).pathname.startsWith('/api/0/')) return next();
  if (!request.headers.get('authorization')) return detail(401, 'Authentication credentials were not provided.');
  const token = bearerToken(ctx);
  if (!token) return detail(401, 'Invalid token');
  // Core refresh reads use the spec's scopes, with Sentry's inherited write/admin grants.
  if (!ctx.call.operation.resource || !['list', 'retrieve'].includes(ctx.call.operation.class)) return next();
  // source: https://docs.sentry.io/api/permissions/ "Scopes"
  const scope = (ctx.call.operation.scopes ?? []).find((s) => grants(token, s));
  if (!scope) return forbidden();
  // source: spec:listOrganizationProjects "The ID or slug of the organization"
  const org = orgFor(ctx, scope);
  if (org instanceof Response) return org;
  const params: Record<string, string> = { ...ctx.call.params, organization_id_or_slug: String(org.id) };
  // source: spec:getProjectEvent "The ID or slug of the project"
  if (ctx.call.params.project_id_or_slug !== undefined) {
    const at = projectFor(ctx, scope);
    if (at instanceof Response) return at;
    params.project_id_or_slug = String(at.project.id);
    // source: spec:listProjectMonitorCheckins "The ID or slug of the monitor"
    if (ctx.call.params.monitor_id_or_slug !== undefined) {
      const ref = ctx.call.params.monitor_id_or_slug;
      const monitor = ctx.rowsRaw(MONITOR).find((m) => m.deleted !== true && m._project === at.project.id && (m.id === ref || m.slug === ref));
      if (!monitor) return detail(404, 'The requested resource does not exist');
      params.monitor_id_or_slug = String(monitor.id);
    }
  }
  const url = new URL(request.url);
  url.pathname = ctx.call.operation.path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));
  return next(new Request(url, request));
}
