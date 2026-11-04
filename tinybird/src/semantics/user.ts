// `GET /v0/user/workspaces`: the Workspaces the user token's person administers (`tb workspace ls`). An `admin <email>`
// token belongs to that person's account, so it lists them as their user token does (the CLI lists them with the
// project's token before it deletes one).
import type { HandlerContext } from '@volter/world-core';
import { answer, tinybirdWorkspaces, workspaceView } from './shared.ts';

export async function user_workspaces(ctx: HandlerContext): Promise<Response> {
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "admin <your-email> token for that Workspace that belongs specifically to your user account for CLI usage."
  return answer(ctx, 'user-or-admin', (req, _query, _token, caller) => {
    const email = (caller as { email: string }).email;
    const mine = tinybirdWorkspaces(req.store).filter((w) => w.owner === email);
    return { status: 200, body: { workspaces: mine.map((w) => workspaceView(w, { role: 'admin', owner: w.owner, organization_id: w.organizationId, created_at: w.createdAt })) } };
  });
}
