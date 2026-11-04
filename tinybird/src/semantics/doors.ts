// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: the World's stand-in for a person's inbox, where the one-time code the console's log-in sends arrives
// (screens/console.tsx).
import type { HandlerContext } from '@volter/world-core';
import { createTinybirdOrganization, createTinybirdWorkspace, generationOf, hasScope, storedToken, TINYBIRD_REGIONS, tokenKey, tokenOf, tokenValue } from './shared.ts';

/** GET /_twin/mailbox/{email}: the messages sent to the person, newest first. */
export async function mailbox(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const messages = ctx.rowsRaw('_mail').filter((m) => m.to === email).sort((a, b) => Number(b.at) - Number(a.at))
    .map((m) => ({ from: m.from, to: m.to, subject: m.subject, text: m.text, at: m.at }));
  return Response.json({ messages });
}

/** The admin token of a deployment's Workspace inside the selected organization's Tinybird account. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const organizationId = await ctx.account();
    const organization = await ctx.tenant('_organization', (org) => createTinybirdOrganization(ctx, {
      name: org.label, admin: org.members[0]!, region: TINYBIRD_REGIONS[0]!.path,
    }));
    const salt = await ctx.secret('tinybird-token-salt');
    const workspace = await ctx.deploymentObject(`workspace:${String(organization.orgId)}`, 'Workspace', async (deployment) => {
      const rule = { max: Number.MAX_SAFE_INTEGER, allowed: /[A-Za-z0-9_]/, separator: '_', first: /[A-Za-z]/ };
      const label = deployment || 'world';
      const identity = deployment === '' ? organizationId : `${organizationId}/${deployment}`;
      let made = await createTinybirdWorkspace(ctx, { name: ctx.vendorName(label, rule, { identity }),
        organizationId: String(organization.orgId), owner: String(organization.admin), salt });
      if (made instanceof Response) made = await createTinybirdWorkspace(ctx, { name: ctx.vendorName(label, rule, { suffixed: true, identity }),
        organizationId: String(organization.orgId), owner: String(organization.admin), salt });
      if (made instanceof Response) {
        const refused = await made.json() as { error: string };
        throw Response.json({ error: `${refused.error} (${identity})` }, { status: made.status });
      }
      return made.id;
    });
    const id = `${String(workspace.id)}/${tokenKey('admin token')}`;
    const token = await ctx.accountKey('admin-token', 'Token', {
      make: async () => {
        const current = ctx.row('Token', id);
        if (!current || !hasScope(tokenOf(current), 'ADMIN')) {
          const before = ctx.row('Token', id, { withDeleted: true });
          const generation = before ? generationOf(before) + 1 : 0;
          await ctx.write('Token', id, { ...storedToken({ name: 'admin token', token: tokenValue(String(workspace.id), 'admin token', generation, salt), scopes: ['ADMIN'] }, generation),
            ws: workspace.id, deleted: false }, 'token.create');
        }
        return id;
      },
      read: async (row) => row.ws === workspace.id && hasScope(tokenOf(row), 'ADMIN') && typeof row.token === 'string' ? row.token : undefined,
    });
    return Response.json({ token: token.secret, workspace: workspace.name }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
