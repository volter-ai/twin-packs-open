// `DELETE /v0/workspaces/{id}` with a user token: a Workspace deleted by its admin (`tb workspace delete … --user_token`).
import type { HandlerContext } from '@volter/world-core';
import { answer, deleteWorkspace, param, readOnlyRejection, tbError, tinybirdWorkspaces, workspaceView } from './shared.ts';

export async function delete_workspace(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'user', async (req, _query, _token, caller) => {
    const id = param(ctx, 'id');
    const w = tinybirdWorkspaces(req.store).find((x) => x.id === id);
    if (!w) return tbError(404, `Workspace '${id}' not found`);
    // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "user token for creating new Workspaces or deleting ones where you are an admin."
    if (w.owner !== (caller as { email: string }).email) return tbError(403, 'only an admin of the Workspace can do this');
    if (req.readOnly) return readOnlyRejection();
    req.ws = w.id;
    await deleteWorkspace(req);
    return { status: 200, body: workspaceView(w) };
  });
}
