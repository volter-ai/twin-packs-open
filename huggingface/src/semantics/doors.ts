// The World's account door stands in for the Hub's account and token settings pages.
import type { HandlerContext } from '@volter/world-core';
import { sha256, USER, TOKEN } from './shared.ts';

// source: https://huggingface.co/docs/hub/security-tokens "New token"
export async function users(ctx: HandlerContext): Promise<Response> {
  const b = ctx.body && typeof ctx.body === 'object' ? ctx.body as Record<string, unknown> : {};
  if (b.account !== undefined || b.deployment !== undefined) return deploymentToken(ctx);
  const name = String(b.name ?? '');
  if (!/^[A-Za-z0-9][\w-]{0,41}$/.test(name)) return Response.json({ message: 'name must be a Hugging Face username' }, { status: 400 });
  // Local credential format, generated from the World's secret; never from an externally guessable id.
  const token = `hf_${(await ctx.secret(`huggingface-token:${name}`)).replace(/[^A-Za-z]/g, 'a').slice(0, 34)}`;
  await ctx.createUnique(USER, { name, token_sha256: sha256(ctx, token) }, 'user.create');
  return Response.json({ name, token }, { status: 201 });
}

async function deploymentToken(ctx: HandlerContext): Promise<Response> {
  try {
    const user = await ctx.tenant(USER, async (organization) => {
      const email = organization.members[0]!.toLowerCase();
      const existing = ctx.rowsRaw(USER).find((row) => row.email === email);
      if (existing) return String(existing.id);
      const rule = { max: 42, allowed: /[A-Za-z0-9_-]/, first: /[A-Za-z0-9]/ };
      const create = (suffixed: boolean) => ctx.createUnique(USER, { name: ctx.vendorName(organization.id, rule, { suffixed, identity: organization.id }), email }, 'user.create');
      let made = await create(false);
      if (!made.created) made = await create(true);
      if (!made.created) throw Response.json({ message: `Account already exists (${organization.id})` }, { status: 409 });
      return String(made.row.id);
    });
    const key = await ctx.accountKey('access-token', TOKEN, {
      make: async () => {
        const id = await ctx.issue(TOKEN);
        const label = `huggingface-access-token:${id}`;
        const value = `hf_${(await ctx.secret(label)).replace(/[^A-Za-z]/g, 'a').slice(0, 34)}`;
        await ctx.record(TOKEN, { user: user.id, name: ctx.deployment() || 'world', role: 'write', label, sha256: sha256(ctx, value) }, id);
        return id;
      },
      read: async (row) => {
        if (row.user !== user.id || typeof row.label !== 'string' || row.revoked === true) return undefined;
        const value = `hf_${(await ctx.secret(row.label)).replace(/[^A-Za-z]/g, 'a').slice(0, 34)}`;
        return sha256(ctx, value) === row.sha256 ? value : undefined;
      },
    });
    return Response.json({ name: user.name, token: key.secret }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}
