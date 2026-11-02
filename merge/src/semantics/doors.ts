// The World's doors (architecture, "Doors, screens and the gap"): what Gateway's dashboard does. An organization on the
// Pro plan with its prepaid credit, and its API key (the API keys page).
import type { HandlerContext } from '@volter/world-core';
import { KEY, ORG, sha256 } from './shared.ts';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** An organization with its credit in USD (10 when unsaid, a month's included credit), the gated providers support has
 *  granted it (`access`, e.g. ['anthropic']; a grant is asked of support, not the API), and its API key: `mg_` and 40
 *  letters and digits drawn from the World's secret. Made at the World's clock, which says whether a gated provider's
 *  cutoff has passed. */
// source: https://docs.merge.dev/merge-gateway/api-overview "Authorization: Bearer mg_..."
export async function organizations(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const account = await ctx.account();
  if (b.account !== undefined) {
    const held = ctx.rowsRaw(ORG).find(o => o._world_account === account);
    const key = held && ctx.rowsRaw(KEY).find(k => k._organization === held.id);
    if (held && key) {
      const value = `mg_${(await ctx.secret(`merge-api-key:${key.id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;
      if (key.sha256 === sha256(ctx, value)) return Response.json({ organization_id: held.id, api_key: value, credit_usd: held.credit_usd, access: held.access, created_at: held.created_at }, { status: 201 });
    }
  }
  const credit = b.credit_usd === undefined ? 10 : Number(b.credit_usd);
  if (!Number.isFinite(credit) || credit < 0) return Response.json({ message: 'credit_usd must be a number of dollars, 0 or more' }, { status: 400 });
  const access = b.access === undefined ? [] : b.access;
  if (!Array.isArray(access) || access.some((p) => typeof p !== 'string')) return Response.json({ message: 'access must be a list of provider slugs' }, { status: 400 });
  const id = ctx.mint(ORG);
  // Where the documentation stops: the organizations the twin makes are on the Pro plan (the Free plan's model list is not published)
  await ctx.record(ORG, { ...(b.account !== undefined ? { _world_account: account } : {}), name: typeof b.name === 'string' ? b.name : 'World organization', plan: 'pro', credit_usd: credit, spent_usd: 0, access, created_at: ctx.occurredAt }, id);
  const keyId = ctx.mint(KEY);
  const key = `mg_${(await ctx.secret(`merge-api-key:${keyId}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`;
  await ctx.record(KEY, { _organization: id, sha256: sha256(ctx, key) }, keyId);
  return Response.json({ organization_id: id, api_key: key, credit_usd: credit, access, created_at: ctx.occurredAt }, { status: 201 });
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
