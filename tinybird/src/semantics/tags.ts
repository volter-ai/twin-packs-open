// Tags (labels on Data Sources and Pipes; `tb push` syncs a datafile's TAGS): list, create and update. The reference
// pages document no Tags API: its requests are tinybird-cli's (spec/client-ops.json, `get_all_tags`,
// `create_tag_with_resource`, `update_tag`), its answers the shape the CLI reads back (`tags`, each with its
// `resources`). Where the documentation stops: the twin lets an ADMIN token manage tags, the token `tb push` uses.
import type { HandlerContext } from '@volter/world-core';
import { answer, chDateTime, cleanTagResources, getRow, hasScope, nowIso, param, parseJsonObject, readOnlyRejection, resourceId, retiredId, rowsOfType, tagKey, tagView, tbError, write, wsOf } from './shared.ts';

const ADMIN_ONLY = 'managing tags requires an ADMIN token';

/** GET /v0/tags. */
export async function get_all_tags(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    if (!hasScope(token, 'ADMIN')) return tbError(403, ADMIN_ONLY);
    return { status: 200, body: { tags: rowsOfType('tag', req).map(tagView) } };
  });
}

/** POST /v0/tags: a tag with the resources it labels. */
export async function create_tag_with_resource(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, _query, token) => {
    if (!hasScope(token, 'ADMIN')) return tbError(403, ADMIN_ONLY);
    if (req.readOnly) return readOnlyRejection();
    const json = parseJsonObject(req.body);
    const name = typeof json?.name === 'string' ? json.name : undefined;
    if (!name) return tbError(400, "You need to provide a value for 'name'");
    if (getRow('tag', tagKey(name), req)) return tbError(409, `Tag '${name}' already exists`);
    const resources = cleanTagResources(json?.resources);
    if (!resources) return tbError(400, "'resources' must be a list of {id, name, type}");
    const at = chDateTime(nowIso(req));
    const row = await write('tag', tagKey(name), {
      id: resourceId('tag', `${wsOf(req)}:${name}`, retiredId('tag', tagKey(name), req)), name, resources, created_at: at, updated_at: at, deleted: false,
    }, 'tag.create', req);
    return { status: 200, body: tagView(row) };
  });
}

/** PUT /v0/tags/<name>: the resources it labels replaced. */
export async function update_tag(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, _query, token) => {
    if (!hasScope(token, 'ADMIN')) return tbError(403, ADMIN_ONLY);
    if (req.readOnly) return readOnlyRejection();
    const name = param(ctx, 'name');
    if (!getRow('tag', tagKey(name), req)) return tbError(404, `Tag '${name}' not found`);
    const json = parseJsonObject(req.body);
    const resources = cleanTagResources(json?.resources);
    if (!resources) return tbError(400, "'resources' must be a list of {id, name, type}");
    const row = await write('tag', tagKey(name), { resources, updated_at: chDateTime(nowIso(req)) }, 'tag.update', req);
    return { status: 200, body: tagView(row) };
  });
}
