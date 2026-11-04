// What Jira's lanes share (a lane imports its vendor's shared semantics): its sites and people, OAuth grants, Jira's
// error body, and Atlassian Document Format (ADF), in which descriptions and comments are written.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const SITE = '_site';
export const PERSON = '_person';
export const APP = '_app';
export const CODE = '_code';
export const ACCESS = '_access_token';
export const REFRESH = '_refresh_token';
export const API_TOKEN = '_api_token';
export const PROJECT = 'Project';
export const ISSUE = 'IssueBean';
export const COMMENT = 'Comment';
export const COMPONENT = 'ProjectComponent';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = <T = Row>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

/** A token-shaped value drawn from the World's secret (Atlassian's are long opaque strings). */
export const tokenValue = async (ctx: Pick<HandlerContext, 'secret'>, label: string): Promise<string> =>
  `${await ctx.secret(label)}${await ctx.secret(`${label}:2`)}`.replace(/[^A-Za-z0-9_-]/g, '');

// source: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/ "errorMessages"
/** Jira's error body: messages, and field errors by field. */
export const jiraError = (status: number, messages: string[], errors: Row = {}): Response => Response.json({ errorMessages: messages, errors }, { status });

// source: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ "expires_in"
// Where the documentation stops: an access token lives an hour, as Atlassian's do in practice
export const ACCESS_TTL = 3600;

type Grant = { sites: string[]; person: string; scopes: string[] };
/** The grant a request's `Authorization: Bearer` names, while it lives. */
export function grantOf(ctx: HandlerContext): Grant | undefined {
  const value = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const t = value ? ctx.rowsRaw(ACCESS).find((r) => r.sha256 === sha256(ctx, value) && r.revoked !== true) : undefined;
  if (!t || Date.parse(String(t.expires)) <= Date.parse(ctx.occurredAt)) return undefined;
  return { sites: arr<string>(t.sites), person: String(t.person), scopes: String(t.scope).split(' ') };
}
