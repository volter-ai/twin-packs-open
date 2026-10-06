// What QStash does around every request to its API (docs/contributing/architecture.md, around.ts): a request without the
// account's token, on the region's host its QStash is at, is refused (spec: 401 Unauthorized, `{ error }`; where the
// documentation stops, its words are the twin's).
import type { HandlerContext } from '@volter/world-core';
import { callerQStash, fail } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (!callerQStash(ctx)) return fail(401, 'Unauthorized');
  return next();
}
