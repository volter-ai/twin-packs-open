// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: the World's stand-in for a person's inbox, where the one-time code the console's log-in sends arrives
// (screens/console.tsx).
import type { HandlerContext } from '@volter/world-core';
import { createTinybirdWorkspace, storeOf, TINYBIRD_REGIONS, tinybirdWorkspaces, tinybirdWorkspaceTokens } from './shared.ts';

/** GET /_twin/mailbox/{email}: the messages sent to the person, newest first. */
export async function mailbox(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const messages = ctx.rowsRaw('_mail').filter((m) => m.to === email).sort((a, b) => Number(b.at) - Number(a.at))
    .map((m) => ({ from: m.from, to: m.to, subject: m.subject, text: m.text, at: m.at }));
  return Response.json({ messages });
}

/** POST /_twin/app-credentials: the token the World's application holds as TINYBIRD_API_KEY (the descriptor's
 *  credentialDoor): the admin token of the World's Workspace `world`, which its owner reads on the console's Tokens page,
 *  made the first time the runtime asks (an Organization and a Tinybird Classic Workspace, as the console makes them)
 *  and the same at every boot after. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  const suffix = account === 'default' ? '' : `-${ctx.crypto.sha256(account).slice(0, 24)}`;
  const name = `world${suffix}`;
  const store = storeOf(ctx);
  const owner = account === 'default' ? 'owner@world.test' : `owner+${ctx.crypto.sha256(account).slice(0, 24)}@world.test`;
  let ws = tinybirdWorkspaces(store).find((w) => w.name === name);
  if (!ws) {
    const org = name;
    if (!ctx.rowsRaw('_organization').some((o) => o.id === org)) {
      await ctx.record('_organization', { orgId: org, name: 'World', admin: owner, region: TINYBIRD_REGIONS[0]!.path, plan: 'free', status: 'active', created_at: ctx.occurredAt }, org);
    }
    ws = await createTinybirdWorkspace({ store, occurredAt: ctx.occurredAt, name, organizationId: org, owner, salt: await ctx.secret('tinybird-token-salt') });
  }
  // the Workspace was made with its admin token (shared.ts, createTinybirdWorkspace), which no operation the twin serves
  // deletes
  const admin = tinybirdWorkspaceTokens(store, ws.id).find((t) => t.name === 'admin token')!;
  return Response.json({ token: admin.token, workspace: ws.name }, { status: 201 });
}
