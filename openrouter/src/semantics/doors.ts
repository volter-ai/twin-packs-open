// The World's doors (architecture, "Doors, screens and the gap"): what openrouter.ai's pages do outside its API.
//
//   POST /_twin/app-credentials           the application's key (the descriptor's credentialDoor), the same every boot
//   POST /_twin/users { email, name? }    a person who signs in at openrouter.ai
//   POST /_twin/keys { email, name }      a key of theirs, shown once (Settings > Keys > Create Key)
import type { HandlerContext } from '@volter/world-core';
import { KEY, makeKey, readKey, PERSON, personByEmail } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Record<string, unknown> => (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;

async function ensurePerson(ctx: HandlerContext, email: string, name: string | null): Promise<string> {
  const made = await ctx.createUnique(PERSON, { email: email.toLowerCase(), name, created_at: ctx.occurredAt }, 'user.create');
  return String(made.row.id);
}

/** A named key of the first member, with an explicit native revocation left in force. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const user = await ctx.tenant(PERSON, (world) => ensurePerson(ctx, world.members[0]!, world.label));
  const organization = await ctx.account(), deployment = ctx.deployment();
  const name = deployment || 'world-app';
  const candidates = ctx.rowsRaw(KEY, { withDeleted: true }).filter((row) => row.user === user.id && row.name === name
    && ((row._world_organization === organization && row._world_deployment === deployment)
      || (organization === 'default' && !deployment && row._world_organization === undefined)));
  const prior = candidates[0];
  if (candidates.some((row) => row.deleted === true || row.disabled === true)) return Response.json({ error: 'the application key was revoked' }, { status: 409 });
  const key = await ctx.accountKey(`api-key:${user.id}`, KEY, {
    make: async () => {
      if (prior && await readKey(ctx, prior)) return String(prior.id);
      const id = await makeKey(ctx, String(user.id), name);
      await ctx.record(KEY, { _world_organization: organization, _world_deployment: deployment }, id);
      return id;
    },
    read: (row) => row.user === user.id ? readKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}

export async function users(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  if (typeof b.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return Response.json({ error: 'an email is required' }, { status: 400 });
  return Response.json({ id: await ensurePerson(ctx, b.email, typeof b.name === 'string' ? b.name : null) }, { status: 201 });
}

export async function keys(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const person = typeof b.email === 'string' ? personByEmail(ctx, b.email) : undefined;
  if (!person || typeof b.name !== 'string' || !b.name) return Response.json({ error: 'the email of a person the World holds, and a name, are required' }, { status: 400 });
  const id = await makeKey(ctx, String(person.id), b.name);
  return Response.json({ key: await readKey(ctx, ctx.row(KEY, id)!) }, { status: 201 });
}
