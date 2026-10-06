// Slack's methods as its spec gives them: each one's operation, the HTTP method the spec names and the scopes it takes
// (../generated/surface.gen.json, from ../spec). "Methods can be called with HTTP GET or POST"
// (https://docs.slack.dev/apis/web-api/#basics): the spec names one, and a call with the other reaches the same method.
import surface from '../generated/surface.gen.json' with { type: 'json' };

export type Method = { id: string; method: string; path: string; scopes: string[] };

type Op = { id: string; method: string; path: string; scopes?: string[] };
const METHODS = new Map<string, Method>((surface.operations as Op[]).map((o) => [o.path.replace(/^\//, ''), { id: o.id, method: o.method.toUpperCase(), path: o.path, scopes: o.scopes ?? [] }]));

/** Every scope any of Slack's methods names. */
export const allScopes = (): string[] => [...new Set([...METHODS.values()].flatMap((m) => m.scopes).filter((s) => s !== 'none'))];

/** The method a path names (`/api/chat.postMessage` or `/chat.postMessage`), if Slack has it. */
export function methodOf(path: string): Method | undefined {
  return METHODS.get(path.replace(/^\/(api\/)?/, '').replace(/\/+$/, ''));
}

/** What a token's granted scopes lack for a method: undefined when it may call it (a method the spec gives no scope,
 *  or `none`, takes any token), else the scope the method names first, as Slack's `needed`. "missing_scope: The token
 *  used is not granted the specific scope permissions required to complete this request" (every method's Errors). */
export function missingScope(method: Method, granted: '*' | readonly string[]): string | undefined {
  if (granted === '*') return undefined;
  const needs = method.scopes.filter((s) => s !== 'none');
  if (needs.length === 0) return undefined;
  // a scope's `:write` holder may read too where the spec names only the read (Slack's own ladders: channels:write
  // does not grant channels:read, so no ladder is assumed); a method listing several accepts any one of them
  return needs.some((s) => granted.includes(s)) ? undefined : needs[0];
}
