// A product's organizations (worker/src/product.ts, ADR-0002): the door a product's server uses with its own
// client_credentials token for `<issuer>/organizations`. It acts only on the organizations that product created
// (`metadata.product`), finds people by id or email, and leaves who may do what to the product.
import type { HandlerContext } from '@volter/world-core';
import { INVITATION, live, MEMBER, nowSeconds, ORGANIZATION, organizationsOf, type Row, userByEmail, userById, verified } from './shared.ts';

const ROLES = new Set(['owner', 'admin', 'member']);
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const refused = (status: number, message: string): Response => json({ error: message }, status);
const body = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? ctx.body as Row : {});

/** The product a request speaks for: the client of a current `organizations` token for this resource. */
async function productOf(ctx: HandlerContext): Promise<string | undefined> {
  const token = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const claims = token ? await verified(ctx, token) : undefined;
  if (!claims || claims.aud !== organizationsOf(ctx) || !String(claims.scope ?? '').split(' ').includes('organizations')) return undefined;
  return String(claims.azp ?? claims.client_id ?? '') || undefined;
}
const gate = async (ctx: HandlerContext): Promise<string | Response> => (await productOf(ctx)) ?? refused(401, "a product's organizations token is required");
const person = (u: Row): Row => ({ id: u.id, email: u.email, name: u.name ?? null, image: u.image ?? null });
const view = (o: Row, role?: string): Row => ({ id: o.id, slug: o.slug, name: o.name, ...(role ? { role } : {}) });
/** An organization of this product, by id or slug. */
const orgOf = (ctx: HandlerContext, product: string, ref: string): Row | undefined =>
  ctx.rowsRaw(ORGANIZATION).find((o) => o.deleted !== true && (o.id === ref || o.slug === ref) && o.product === product);
const newId = (ctx: HandlerContext, kind: string): string => ctx.mint(kind);

// source: spec:productPeopleByEmail "A Volter identity by its email"
export async function productPeopleByEmail(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const email = String(ctx.params.email ?? '').trim().toLowerCase();
  if (!email) return refused(400, 'an email is required');
  const u = userByEmail(ctx, email);
  return u ? json(person(u)) : refused(404, 'no Volter identity has that email');
}

// source: spec:productPersonById "A Volter identity by its id"
export async function productPersonById(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const u = userById(ctx, String(ctx.call.params.id));
  return u ? json(person(u)) : refused(404, 'no such person');
}

// source: spec:productPersonOrganizations "A person's organizations of this product, with the person's role"
export async function productPersonOrganizations(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const mine = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m.userId === ctx.call.params.id);
  const orgs = mine.map((m) => ({ o: live(ctx.row(ORGANIZATION, String(m.organizationId))), role: String(m.role) })).filter((x) => x.o && x.o.product === p);
  return json(orgs.sort((a, b) => String(a.o!.slug).localeCompare(String(b.o!.slug))).map((x) => view(x.o!, x.role)));
}

// source: spec:productCreateOrganization "An organization of this product, its creator its owner"
export async function productCreateOrganization(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const { name, slug, createdBy } = body(ctx) as { name?: string; slug?: string; createdBy?: string };
  if (!name?.trim() || !slug || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) return refused(400, 'a name and a lowercase slug are required');
  if (!createdBy || !userById(ctx, createdBy)) return refused(400, 'createdBy must name a Volter identity');
  if (ctx.rowsRaw(ORGANIZATION).some((o) => o.deleted !== true && o.slug === slug)) return refused(409, 'that slug is taken');
  const id = newId(ctx, ORGANIZATION);
  await ctx.write(ORGANIZATION, id, { id, slug, name: name.trim(), product: p, createdAt: ctx.occurredAt }, 'organization.create');
  const mid = newId(ctx, MEMBER);
  await ctx.write(MEMBER, mid, { id: mid, organizationId: id, userId: createdBy, role: 'owner', createdAt: ctx.occurredAt }, 'member.create');
  return json(view({ id, slug, name: name.trim() }, 'owner'), 201);
}

// source: spec:productGetOrganization "An organization of this product by id or slug"
export async function productGetOrganization(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  return o ? json(view(o)) : refused(404, 'no such organization');
}

// source: spec:productRenameOrganization "An organization's name changed"
export async function productRenameOrganization(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const name = String(body(ctx).name ?? '').trim();
  if (!name) return refused(400, 'a name is required');
  await ctx.write(ORGANIZATION, String(o.id), { name }, 'organization.update');
  return json(view({ ...o, name }));
}

// source: spec:productDeleteOrganization "An organization deleted"
export async function productDeleteOrganization(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  for (const m of ctx.rowsRaw(MEMBER).filter((m) => m.organizationId === o.id && m.deleted !== true)) await ctx.remove(MEMBER, String(m.id), 'member.delete');
  await ctx.remove(ORGANIZATION, String(o.id), 'organization.delete');
  return json({ deleted: true });
}

// source: spec:productListMembers "An organization's members"
export async function productListMembers(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const members = ctx.rowsRaw(MEMBER).filter((m) => m.deleted !== true && m.organizationId === o.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return json(members.map((m) => { const u = userById(ctx, String(m.userId)); return { id: m.id, userId: m.userId, email: u?.email ?? null, name: u?.name ?? null, role: m.role }; }));
}

// source: spec:productAddMember "A member added (admin or member)"
export async function productAddMember(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const { userId, role = 'member' } = body(ctx) as { userId?: string; role?: string };
  if (!userId || !userById(ctx, userId)) return refused(400, 'userId must name a Volter identity');
  if (!ROLES.has(role) || role === 'owner') return refused(400, 'role is admin or member');
  if (ctx.rowsRaw(MEMBER).some((m) => m.deleted !== true && m.organizationId === o.id && m.userId === userId)) return refused(409, 'already a member');
  const id = newId(ctx, MEMBER);
  await ctx.write(MEMBER, id, { id, organizationId: o.id, userId, role, createdAt: ctx.occurredAt }, 'member.create');
  return json({ id, userId, role }, 201);
}

const memberOf = (ctx: HandlerContext, o: Row): Row | undefined => ctx.rowsRaw(MEMBER).find((m) => m.deleted !== true && m.organizationId === o.id && m.userId === ctx.call.params.userId);

// source: spec:productChangeMemberRole "A member's role changed"
export async function productChangeMemberRole(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const role = String(body(ctx).role ?? '');
  if (!ROLES.has(role)) return refused(400, 'role is owner, admin or member');
  const m = memberOf(ctx, o);
  if (!m) return refused(404, 'not a member');
  const refusal = ctx.legal(MEMBER, 'role', 'productChangeMemberRole', m.role, role, String(m.id));
  if (refusal) return ctx.refuse(refusal);
  await ctx.write(MEMBER, String(m.id), { role }, 'member.update');
  return json({ userId: m.userId, role });
}

// source: spec:productRemoveMember "A member removed"
export async function productRemoveMember(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const m = memberOf(ctx, o);
  if (!m) return refused(404, 'not a member');
  await ctx.remove(MEMBER, String(m.id), 'member.delete');
  return json({ removed: true });
}

// source: spec:productListInvitations "An organization's pending invitations"
export async function productListInvitations(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const pending = ctx.rowsRaw(INVITATION).filter((i) => i.deleted !== true && i.organizationId === o.id && i.status === 'pending' && Date.parse(String(i.expiresAt)) / 1000 > nowSeconds(ctx));
  return json(pending.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt })));
}

// source: spec:productCreateInvitation "An invitation by email, for a week"
export async function productCreateInvitation(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const b = body(ctx) as { email?: string; role?: string; inviterId?: string };
  const email = b.email?.trim().toLowerCase();
  const role = b.role ?? 'member';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refused(400, 'an email is required');
  if (!ROLES.has(role) || role === 'owner') return refused(400, 'role is admin or member');
  if (!b.inviterId || !userById(ctx, b.inviterId)) return refused(400, 'inviterId must name a Volter identity');
  const id = newId(ctx, INVITATION);
  const invitation = { id, email, role, createdAt: ctx.occurredAt, expiresAt: new Date(Date.parse(ctx.occurredAt) + 7 * 86_400_000).toISOString() };
  await ctx.write(INVITATION, id, { ...invitation, organizationId: o.id, status: 'pending', inviterId: b.inviterId }, 'invitation.create');
  return json(invitation, 201);
}

// source: spec:productCancelInvitation "A pending invitation cancelled"
export async function productCancelInvitation(ctx: HandlerContext): Promise<Response> {
  const p = await gate(ctx); if (p instanceof Response) return p;
  const o = orgOf(ctx, p, String(ctx.call.params.ref));
  if (!o) return refused(404, 'no such organization');
  const i = live(ctx.row(INVITATION, String(ctx.call.params.invitationId)));
  if (!i || i.organizationId !== o.id || i.status !== 'pending') return refused(404, 'no such pending invitation');
  const refusal = ctx.legal(INVITATION, 'status', 'productCancelInvitation', i.status, 'canceled', String(i.id));
  if (refusal) return ctx.refuse(refusal);
  await ctx.write(INVITATION, String(i.id), { status: 'canceled' }, 'invitation.cancel');
  return json({ cancelled: true });
}

