// The World's doors (architecture, "Doors, screens and the gap"): what Gateway's dashboard does. An organization on the
// Pro plan with its prepaid credit, and its API key (the API keys page).
import type { HandlerContext } from '@volter/world-core';
import { KEY, obj, ORG, sha256 } from './shared.ts';

const keyValue = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> =>
  `mg_${(await ctx.secret(`merge-api-key:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;

/** An organization with its credit in USD (10 when unsaid, a month's included credit), the gated providers support has
 *  granted it (`access`, e.g. ['anthropic']; a grant is asked of support, not the API), and its API key: `mg_` and 40
 *  letters and digits drawn from the World's secret. Made at the World's clock, which says whether a gated provider's
 *  cutoff has passed. */
// source: https://docs.merge.dev/merge-gateway/api-overview "Authorization: Bearer mg_..."
export async function organizations(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const credit = b.credit_usd === undefined ? 10 : Number(b.credit_usd);
  if (!Number.isFinite(credit) || credit < 0) return Response.json({ message: 'credit_usd must be a number of dollars, 0 or more' }, { status: 400 });
  const access = b.access === undefined ? [] : b.access;
  if (!Array.isArray(access) || access.some((p) => typeof p !== 'string')) return Response.json({ message: 'access must be a list of provider slugs' }, { status: 400 });
  const selected = b.account !== undefined || b.deployment !== undefined;
  const makeOrganization = (name: string, owner?: string): Promise<string> => ctx.record(ORG, {
    name: typeof b.name === 'string' ? b.name : name, ...(owner ? { owner } : {}),
    plan: 'pro', credit_usd: credit, spent_usd: 0, access, created_at: ctx.occurredAt,
  });
  const org = selected
    ? await ctx.tenant(ORG, (organization) => makeOrganization(organization.label, organization.members[0]!))
    : ctx.row(ORG, await makeOrganization('World organization'))!;
  const makeKey = async (): Promise<string> => {
    const id = await ctx.issue(KEY);
    const value = await keyValue(ctx, id);
    await ctx.record(KEY, { _organization: org.id, name: ctx.deployment() || 'world', sha256: sha256(ctx, value) }, id);
    return id;
  };
  const value = selected ? (await ctx.accountKey('gateway-key', KEY, {
    make: makeKey,
    read: async (row) => {
      if (row._organization !== org.id) return undefined;
      const value = await keyValue(ctx, String(row.id));
      return row.sha256 === sha256(ctx, value) ? value : undefined;
    },
  })).secret : await keyValue(ctx, await makeKey());
  return Response.json({ organization_id: org.id, api_key: value, credit_usd: org.credit_usd, access: org.access, created_at: org.created_at }, { status: 201 });
}

/** Support's grant of a gated provider to an organization (`{ organization_id, provider }`): asked in the in-app chat
 *  or by email, applied org-wide; the organization's 403s stop and its catalogue loses the label. */
// source: https://docs.merge.dev/merge-gateway/model-access/vendor-access "A grant applies org-wide with no change on your side"
export async function access(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const org = typeof b.organization_id === 'string' ? ctx.row(ORG, b.organization_id) : undefined;
  if (!org) return Response.json({ message: 'organization_id must name an organization the World made' }, { status: 404 });
  if (typeof b.provider !== 'string' || !b.provider) return Response.json({ message: 'provider must be a provider slug (anthropic)' }, { status: 400 });
  const held = Array.isArray(org.access) ? (org.access as string[]) : [];
  const granted = held.includes(b.provider) ? held : [...held, b.provider];
  await ctx.write(ORG, String(b.organization_id), { access: granted }, 'support.access_granted');
  return Response.json({ organization_id: b.organization_id, access: granted });
}
