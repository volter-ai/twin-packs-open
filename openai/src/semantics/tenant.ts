// One OpenAI account owns its project keys, API state, Codex subscription and media. The kernel
// provides an aggregate read context only for resolving this credential boundary; the request then
// runs against that account's namespace in the same logical log. Unknown credentials get no default.
import { browserSessionToken, passwordHash, sha256, type HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;
const owner = (row: Row | undefined): string | undefined => row ? String(row._world_account ?? 'default') : undefined;
const invalid = '__unselected__';

export async function tenant(ctx: HandlerContext): Promise<string | undefined> {
  const request = ctx.call.request, url = new URL(request.url);
  const path = url.pathname;
  if (path === '/twin' || path === '/twin/') return undefined;
  const body: Row = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)
    ? ctx.body as Row : Object.fromEntries(new URLSearchParams(ctx.text));
  if (path.startsWith('/_twin/')) {
    // The door validates/registers through ctx.account(); authority selection itself never writes.
    const selected = body.account ?? 'default';
    return typeof selected === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(selected) ? selected : invalid;
  }

  const header = request.headers.get('authorization');
  if (header) {
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) return invalid;
    const key = ctx.rowsRaw('api_key', { withDeleted: true }).find(k => k._sha256 === sha256(token));
    const grant = ctx.rowsRaw('_codex_grant', { withDeleted: true }).find(g => g._access === token);
    return owner(key ?? grant) ?? invalid;
  }

  const grants = ctx.rowsRaw('_codex_grant', { withDeleted: true });
  const refresh = body.refresh_token ?? body.token;
  if (typeof refresh === 'string') {
    const grant = grants.find(g => g._refresh === refresh || g._access === refresh);
    return owner(grant) ?? invalid;
  }
  if (typeof body.subject_token === 'string') return owner(grants.find(g => g._id_token === body.subject_token)) ?? invalid;
  if (typeof body.code === 'string') return owner(ctx.rowsRaw('_codex_code').find(c => c.id === sha256(body.code as string))) ?? invalid;
  if (typeof body.email === 'string') {
    const email = body.email.trim().toLowerCase();
    const people = ctx.rowsRaw('_person').filter(p => p.email === email
      && (typeof body.password !== 'string' || p.password_sha256 === passwordHash(email, body.password)));
    const accounts = new Set(people.map(p => owner(p)));
    return accounts.size === 1 ? accounts.values().next().value : invalid;
  }
  if (typeof body.device_auth_id === 'string') {
    // Pending device requests are global negotiation state. Once consent binds an account, polling
    // and the one-use code exchange return to that owner, checked by the existing capability wire.
    return owner(ctx.rowsRaw('_codex_device').find(d => d.id === body.device_auth_id)) ?? invalid;
  }
  const session = browserSessionToken(request, 'platform_session');
  if (session) {
    const held = ctx.rowsRaw('_web_session').find(s => s.token === session);
    return owner(held) ?? invalid;
  }
  if (path.includes('/generated-images/')) {
    const id = String(ctx.call.params.file ?? path.split('/').pop() ?? '').replace(/\.png$/, '');
    return owner(ctx.rowsRaw('_generated_image').find(image => image.id === id && image._sig === url.searchParams.get('sig'))) ?? invalid;
  }
  // Public login, authorization and device-request entrypoints have no account until consent.
  // Legacy unauthenticated gates, dashboard login and default-account acts retain their store.
  return 'default';
}
