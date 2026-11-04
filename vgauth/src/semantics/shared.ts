import type { HandlerContext } from '@volter/world-core';
export type Row = Record<string, any>;
export const ORIGIN = 'https://auth.videogame.ai';
export const now = (ctx: HandlerContext) => Date.parse(ctx.occurredAt);
export const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
export const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
// source: recording:deployment-source.txt "VGAI_ACCOUNT_CLIENT_ID = \"vgai-editor\""
// source: recording:deployment-source.txt "binding = \"VGAI_BILLING\""
export const settings = (ctx: HandlerContext): Row => ({ clerkApi: '', billingBound: true, invitationRateLimit: true, providerClientId: 'akukThq5UTCOrmaO', authorizationEndpoint: `${ORIGIN}/__clerk/oauth/authorize`, tokenEndpoint: 'https://clerk.auth.videogame.ai/oauth/token', webCallback: 'https://workspace.videogame.ai/auth/callback', ...(ctx.get('_settings', 'deployment') ?? {}), clientId: 'vgai-editor' });
export const clerkApi = (ctx: HandlerContext): string => settings(ctx).clerkApi || 'https://api.clerk.com';
// source: recording:collaboration-handoff-source.txt "const iv = crypto.getRandomValues(new Uint8Array(12));"
// The World's own secret plus a fresh occurrence replaces the vendor's random draw. Nothing derives from public ids alone.
export async function draw(ctx: HandlerContext): Promise<string> {
  const occurrence = await ctx.create('_nonce', {}, 'handoff.nonce');
  return ctx.secret(`vgauth:nonce:${occurrence.id}`);
}
// source: recording:collaboration-handoff-source.txt "return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;"
// Callers only echo opaque values to this Worker. The secret-derived lookup preserves forgery refusal and all payload checks.
export async function seal(ctx: HandlerContext, value: Row): Promise<string> {
  const token = ctx.crypto.base62From(await draw(ctx), 64);
  await ctx.record('_handoff', { payload: value }, ctx.crypto.sha256(token));
  return token;
}
// source: recording:collaboration-handoff-source.txt "return null;"
export async function open(ctx: HandlerContext, token: unknown): Promise<Row | null> {
  if (typeof token !== 'string') return null;
  return (ctx.get('_handoff', ctx.crypto.sha256(token))?.payload as Row | undefined) ?? null;
}
export const pkce = (ctx: HandlerContext, value: string) => ctx.crypto.digest('sha256', value, 'base64url');
export const bounded = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
export const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(v);
// source: recording:worker-source.txt "url.pathname === '/__editor/account/browser-authorization/callback';"
export function accountRedirect(ctx: HandlerContext, value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value); if (url.username || url.password || url.search || url.hash) return null;
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/__editor/account/browser-authorization/callback';
    const web = url.protocol === 'https:' && settings(ctx).webCallback && url.toString() === new URL(settings(ctx).webCallback).toString();
    return local || web ? url.toString() : null;
  } catch { return null; }
}
// source: recording:worker-source.txt "url.pathname !== '/__vgai_share/callback'"
export function shareCallback(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && u.pathname === '/__vgai_share/callback' && /(?:^|\.)(?:ngrok(?:-free)?\.(?:app|dev)|trycloudflare\.com)$/i.test(u.hostname) && !u.username && !u.password && !u.search && !u.hash ? u.toString() : null; } catch { return null; }
}
// source: recording:worker-source.txt "const claims = await verifyToken(token, options);"
// source: recording:worker-source.txt "return { userId: claims.sub };"
export async function identity(ctx: HandlerContext, token?: string): Promise<string | Response> {
  const config = settings(ctx);
  if (!config.clerkKey) return fail(500, 'Clerk is not configured.');
  token ??= /^Bearer\s+(.+)$/i.exec(ctx.call.request.headers.get('Authorization')?.trim() ?? '')?.[1]?.trim();
  if (!token) return fail(401, 'Unauthorized');
  try {
    const res = await ctx.vendorFetch(`${clerkApi(ctx)}/v1/jwks`, { headers: { Authorization: `Bearer ${config.clerkKey}` } });
    if (!res.ok) return fail(401, 'Unauthorized');
    const verified = ctx.crypto.jwtVerify(token, await res.json(), { now: Math.floor(now(ctx) / 1000) });
    if (!verified.valid || !verified.payload?.sub) return fail(401, 'Unauthorized');
    if (config.authorizedParties?.length && !config.authorizedParties.includes(verified.payload.azp)) return fail(401, 'Unauthorized');
    return String(verified.payload.sub);
  } catch { return fail(401, 'Unauthorized'); }
}
// source: recording:worker-source.txt "const user = await get(`/v1/users/${encodeURIComponent(userId)}`);"
export async function participant(ctx: HandlerContext, userId: string): Promise<Row | null> {
  const config = settings(ctx);
  const get = async (path: string): Promise<Row> => { const r = await ctx.vendorFetch(`${clerkApi(ctx)}${path}`, { headers: { Authorization: `Bearer ${config.clerkKey}` } }); if (!r.ok) throw new Error(`Clerk twin organization reader failed (${r.status}).`); return r.json(); };
  const user = await get(`/v1/users/${encodeURIComponent(userId)}`);
  const email = user.email_addresses?.find((v: Row) => v.id === user.primary_email_address_id)?.email_address ?? user.email_addresses?.[0]?.email_address;
  if (typeof email !== 'string') return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const members = await get(`/v1/users/${encodeURIComponent(userId)}/organization_memberships?limit=100`);
  const organizations = await Promise.all((members.data ?? []).slice(0, 100).map(async (m: Row) => {
    const o = m.organization; if (!id(o?.id) || typeof o.name !== 'string') throw new Error('Clerk twin returned an invalid organization membership.');
    const domains = await get(`/v1/organizations/${encodeURIComponent(o.id)}/domains?limit=50`);
    return { id: o.id, name: o.name, ...(o.slug ? { slug: o.slug } : {}), role: m.role ?? 'org:member', domains: (domains.data ?? []).slice(0, 50).map((d: Row) => ({ name: d.name.toLowerCase(), verified: d.verification?.status === 'verified', enrollmentMode: d.enrollment_mode })) };
  }));
  return { id: userId, email, ...(name ? { name } : {}), organizations };
}
// source: recording:worker-source.txt "const upstream = await fetch(configuration.tokenEndpoint, {"
export const providerToken = (ctx: HandlerContext, body: URLSearchParams) => ctx.vendorFetch(settings(ctx).tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });

// source: recording:worker-source.txt "if (!Array.isArray(value) || value.length > 100) return false;"
export function validParticipant(value: Row | undefined): boolean {
  if (!value || !id(value.id) || typeof value.email !== 'string' || value.email.length > 320 || (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 200)) || !Array.isArray(value.organizations) || value.organizations.length > 100) return false;
  return value.organizations.every((o: Row) => o && id(o.id) && typeof o.name === 'string' && o.name.length <= 200 && (o.slug === undefined || (typeof o.slug === 'string' && o.slug.length <= 200)) && typeof o.role === 'string' && o.role.length <= 200 && Array.isArray(o.domains) && o.domains.length <= 50 && o.domains.every((d: Row) => d && typeof d.name === 'string' && d.name.length <= 253 && typeof d.verified === 'boolean' && ['manual_invitation','automatic_invitation','automatic_suggestion','enterprise_sso'].includes(d.enrollmentMode)));
}

// source: recording:worker-source.txt "const token = new URLSearchParams(url.hash.slice(1)).get('token');"
export function invitationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const u = new URL(value); const token = new URLSearchParams(u.hash.slice(1)).get('token');
    if (u.protocol !== 'https:' || !['/', '/index.html'].includes(u.pathname) || !/(?:^|\.)(?:ngrok(?:-free)?\.(?:app|dev)|trycloudflare\.com)$/i.test(u.hostname) || u.username || u.password || u.search || !token || token.length < 32) return null;
    return u.toString();
  } catch { return null; }
}
// source: recording:invitation-rate-limit-source.txt "const MAX_PER_HOUR = 20;"
// source: recording:invitation-rate-limit-source.txt "const MAX_PER_DAY = 50;"
// source: recording:invitation-rate-limit-source.txt "const RECIPIENT_COOLDOWN_MS = 5 * 60_000;"
export async function reserveInvitation(ctx: HandlerContext, host: string, email: string): Promise<number> {
  const t = now(ctx); const hour = ctx.occurredAt.slice(0, 13); const day = hour.slice(0, 10);
  const key = ctx.crypto.sha256(email);
  const { row } = await ctx.createUnique('_invitation_usage', { host, hour: '', day: '', hourCount: 0, dayCount: 0, recipients: {} }, 'invitation.quota.open');
  let retryMs = 0;
  await ctx.change('_invitation_usage', String(row.id), (usage: Row) => {
    const hourCount = usage.hour === hour ? Number(usage.hourCount) : 0;
    const dayCount = usage.day === day ? Number(usage.dayCount) : 0;
    const recipients = Object.fromEntries(Object.entries(usage.recipients ?? {}).filter(([, at]) => t - Number(at) < 300000)) as Record<string, number>;
    // The source prioritizes recipient cooldown, then the hourly and daily windows.
    retryMs = recipients[key] ? 300000 - (t - recipients[key]!) : hourCount >= 20 ? 3600000 - t % 3600000 : dayCount >= 50 ? 86400000 - t % 86400000 : 0;
    return retryMs > 0 ? undefined : { hour, day, hourCount: hourCount + 1, dayCount: dayCount + 1, recipients: { ...recipients, [key]: t } };
  }, 'invitation.quota.reserve');
  return retryMs > 0 ? Math.max(1, Math.ceil(retryMs / 1000)) : 0;
}

// source: recording:worker-source.txt "managedServicesAllowed: user.privateMetadata['vgaiManagedServices'] === true,"
export async function managedAdmission(ctx: HandlerContext, userId: string): Promise<boolean> {
  const response = await ctx.vendorFetch(`${clerkApi(ctx)}/v1/users/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${settings(ctx).clerkKey}` } });
  if (!response.ok) throw new Error('Managed account identity reader failed.');
  return (await response.json()).private_metadata?.vgaiManagedServices === true;
}
