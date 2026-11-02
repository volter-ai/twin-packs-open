// `GET /v0/workspace`: the token's Workspace (`tb auth` reads it to confirm the token, `tb push` before each deploy).
import type { HandlerContext } from '@volter/world-core';
import { answer, hasScope, tinybirdWorkspaces, workspaceView } from './shared.ts';

export async function workspace_info(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    // the token names a Workspace that is stored and not deleted (shared.ts, findCaller)
    const w = tinybirdWorkspaces(req.store).find((x) => x.id === req.ws)!;
    // What the token may do here: an admin token is the Workspace's admin.
    return { status: 200, body: workspaceView(w, { scope: hasScope(token, 'ADMIN') ? 'admin' : 'user' }) };
  });
}
