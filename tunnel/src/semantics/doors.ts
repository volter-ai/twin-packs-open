// The World's door stands in for relay signup: one account token, shared by its deployments.
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, sha256 } from './shared.ts';

const tokenOf = async (ctx: HandlerContext, id: string): Promise<string> =>
  `vt_${ctx.crypto.base62From(await ctx.secret(`tunnel-token:${id}`), 40)}`;

async function makeAccount(ctx: HandlerContext, slug: string, owner?: string): Promise<string | undefined> {
  const made = await ctx.createUnique(ACCOUNT, { slug, ...(owner ? { owner } : {}) }, 'account.create', { input: 'omit' });
  if (!made.created) return undefined;
  const id = String(made.row.id);
  await ctx.record(ACCOUNT, { token_sha256: sha256(ctx, await tokenOf(ctx, id)) }, id);
  return id;
}

/** A native slug is globally unique; the organization's account token is not a deployment credential. */
export async function accounts(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
  let account: Record<string, unknown>;
  if (body.slug !== undefined && body.account === undefined && body.deployment === undefined) {
    const slug = String(body.slug ?? '');
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return Response.json({ message: 'slug must be lowercase letters, digits and dashes' }, { status: 400 });
    const held = ctx.rowsRaw(ACCOUNT).find((row) => row.slug === slug);
    const id = held ? String(held.id) : await makeAccount(ctx, slug);
    account = id ? ctx.row(ACCOUNT, id)! : ctx.rowsRaw(ACCOUNT).find((row) => row.slug === slug)!;
  } else {
    try {
      account = await ctx.tenant(ACCOUNT, async (world) => {
        const label = typeof body.slug === 'string' ? body.slug : world.id === 'default' ? 'world' : world.id;
        for (const suffixed of [false, true]) {
          const slug = ctx.vendorName(label.length < 2 ? `world-${label}` : label,
            { max: 63, lower: true, allowed: /[a-z0-9-]/, first: /[a-z0-9]/ }, { suffixed, identity: world.id });
          const id = await makeAccount(ctx, slug, world.members[0]!.toLowerCase());
          if (id) return id;
        }
        throw Response.json({ message: `An account slug already exists for ${world.id}.` }, { status: 409 });
      });
    } catch (error) { if (error instanceof Response) return error; throw error; }
  }
  const token = await tokenOf(ctx, String(account.id));
  account = ctx.row(ACCOUNT, String(account.id))!;
  if (account.token_sha256 === undefined) {
    await ctx.record(ACCOUNT, { token_sha256: sha256(ctx, token) }, String(account.id));
    account = ctx.row(ACCOUNT, String(account.id))!;
  }
  if (account.token_sha256 !== sha256(ctx, token)) return Response.json({ message: 'The account token is no longer valid.' }, { status: 409 });
  return Response.json({ slug: account.slug, token, server: 'https://voltertest.xyz' }, { status: 201 });
}
