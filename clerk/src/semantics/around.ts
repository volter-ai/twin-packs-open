// What Clerk's Backend API does around every request (docs/contributing/architecture.md, around.ts): the API version. A
// version given both as the header and as the `__clerk_api_version` query parameter, or one Clerk does not have in the
// query form, is refused: "Using both the query parameter and the header simultaneously will lead to an invalid request.
// The same is also true when the version is invalid." (https://clerk.com/docs/guides/development/upgrading/versioning),
// answered as InvalidAPIVersion (400 `api_version_invalid`, "Invalid Clerk API version: <reason>",
// https://clerk.com/docs/guides/development/errors/backend-api). The header form alone is the manifest's `version`.
import type { HandlerContext } from '@volter/world-core';
import { API_VERSIONS, ensureInstanceKey } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  await ensureInstanceKey(ctx);
  const header = ctx.call.request.headers.get('clerk-api-version');
  const param = new URL(ctx.call.request.url).searchParams.get('__clerk_api_version');
  const invalid = (reason: string): Response => ctx.refuse({ status: 400, code: 'api_version_invalid', kind: 'invalid API version', message: `Invalid Clerk API version: ${reason}` });
  if (header !== null && param !== null) return invalid('the version was given both as a header and as a query parameter');
  if (param !== null && !API_VERSIONS.includes(param)) return invalid(param);
  return next();
}
