import type { HandlerContext } from '@volter/world-core';

// source: spec:/components/schemas/BadRequest "BAD_REQUEST"
export const badRequest = () => Response.json({ message: 'BAD_REQUEST' }, { status: 400 });
// source: spec:/components/schemas/NotFound "NOT_FOUND"
export const missing = () => Response.json({ message: 'NOT_FOUND' }, { status: 404 });

// source: https://dev.bitly.com/docs/getting-started/authentication/ "Authorization: Bearer"
export function account(ctx: HandlerContext): string | undefined {
  const token = ctx.call.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return token ? String(ctx.rowsRaw('_access_token').find(r => r.sha256 === ctx.crypto.sha256(token))?.login ?? '') || undefined : undefined;
}

// source: https://dev.bitly.com/docs/getting-started/authentication/ "access_token"
// Where the documentation stops: synthetic account tokens are stable World secrets, never real credentials.
export async function accessToken(ctx: HandlerContext, email: string): Promise<string> {
  const token = (await ctx.secret(`bitly-access:${email}`)).slice(0, 40);
  await ctx.record('_access_token', { email, login: ctx.rowsRaw('_person').find(person => person.email === email)?.login, sha256: ctx.crypto.sha256(token) }, `token:${email}`);
  return token;
}

// source: spec:getBitlinksByGroup "for a group"
export function group(ctx: HandlerContext): Record<string, unknown> | undefined {
  const row = ctx.row('Group', String(ctx.call.params.group_guid));
  return row && row._account === account(ctx) ? ctx.render(row) : undefined;
}

// source: https://dev.bitly.com/docs/getting-started/authentication/ "client_secret"
// Where the documentation stops: registered local clients receive a secret from the World credential facility.
export const clientSecret = (ctx: HandlerContext, id: string) => ctx.secret(String(ctx.row('_client', id)?._secret_label ?? `bitly-client:${id}`));

export async function issueAccessToken(ctx: HandlerContext, email: string, client: string): Promise<string> {
  const id = await ctx.issue('_access_token');
  const label = `bitly-user-grant:${id}`;
  const value = (await ctx.secret(label)).slice(0, 40);
  await ctx.record('_access_token', { email, client_id: client, login: ctx.rowsRaw('_person').find((row) => row.email === email)?.login, label, sha256: ctx.crypto.sha256(value) }, id);
  return id;
}

export async function readAccessToken(ctx: HandlerContext, row: Record<string, unknown>): Promise<string | undefined> {
  if (typeof row.label !== 'string') return undefined;
  const value = (await ctx.secret(row.label)).slice(0, 40);
  return row.sha256 === ctx.crypto.sha256(value) ? value : undefined;
}
