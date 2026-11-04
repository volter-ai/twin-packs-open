// What every family of Sentry's API shares: who is calling (an auth token the World issued), the organization a request
// names and whether the token may act on it, and the API's answers (Django REST framework's `{"detail": ...}`).
import type { HandlerContext } from '@volter/world-core';
import { bearerToken, grants, orgBySlug, projectOf, type Row, wire } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';


export const detail = (status: number, message: string): Response => Response.json({ detail: message }, { status });
// Where the documentation stops: the spec names these answers' statuses (401, 403, 404) without their bodies; the
// messages are Django REST framework's, which Sentry's API answers with
export const notFound = (): Response => detail(404, 'The requested resource does not exist');
export const forbidden = (): Response => detail(403, 'You do not have permission to perform this action.');

/** The organization a request's path names, if the request's token is the organization's and its scopes grant the
 *  operation's (the spec's security scopes for it); else the API's refusal. */
export function orgFor(ctx: HandlerContext, scope: string): Row | Response {
  const token = bearerToken(ctx);
  if (!token) return detail(401, 'Invalid token');
  const org = orgBySlug(ctx, String(ctx.call.params.organization_id_or_slug ?? ''));
  if (!org) return notFound();
  return token.organization === org.id && grants(token, scope) ? org : forbidden();
}

/** The organization and project a request's path names, or the API's refusal. */
export function projectFor(ctx: HandlerContext, scope: string): { org: Row; project: Row } | Response {
  const org = orgFor(ctx, scope);
  if (org instanceof Response) return org;
  const project = projectOf(ctx, org, String(ctx.call.params.project_id_or_slug ?? ''));
  return project ? { org, project } : notFound();
}



export function projectView(ctx: HandlerContext, p: Row, _org: Row): Row { return wire(ctx, p); }
