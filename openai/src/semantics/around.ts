// What OpenAI does around every request to its API (docs/contributing/architecture.md, around.ts): a key must be one
// the organization made (a project key, kept by its SHA-256); any other is OpenAI's incorrect-key answer. A request that
// presents one of the organization's project keys uses it — the key's `last_used_at` is that instant
// (https://platform.openai.com/docs/api-reference/project-api-keys/object, "The Unix timestamp (in seconds) of when the
// API key was last used.") — and a key that has stopped working is refused: one revoked on the keys page or deleted
// through the Admin API, and one of an archived project ("Archived projects cannot be used or updated",
// https://platform.openai.com/docs/api-reference/projects/archive). The refusal is OpenAI's incorrect-key answer, as
// OpenAI documents no other for them. A read-only request is checked the same and records no use.
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { sha256 } from '@volter/world-core';
import { epoch, INVALID_KEY, PROJECT_KEY, timeline } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const header = ctx.call.request.headers.get('authorization')?.trim() ?? '';
  // a request with no key is the kernel's gate's (the manifest's auth.missing); any other header must be a bearer of
  // one key the organization made, and one that still works
  if (!header) return next();
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const key = bearer ? ctx.rowsRaw(PROJECT_KEY, { withDeleted: true }).find((k) => k._sha256 === sha256(bearer)) : undefined;
  if (!key) return ctx.refuse(INVALID_KEY);
  const archived = ctx.row('Project', String(key._project_id))?.status === 'archived';
  if (key.deleted === true || archived) return ctx.refuse(INVALID_KEY);
  // a read-only request (a read-only World, or one that asks to be) records no use
  if (!isReadOnlyRequest(ctx.call.request)) await ctx.write(PROJECT_KEY, String(key.id), { last_used_at: epoch(ctx) }, 'api_key.update');
  return timeline(ctx) ?? next();
}
