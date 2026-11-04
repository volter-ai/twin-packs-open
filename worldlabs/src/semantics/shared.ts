// What World Labs shares: the World's accounts (each API key held by its SHA-256) and the host's refusals.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };
export const ACCOUNT = '_account';

export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v);

// source: https://docs.worldlabs.ai/api/errors "Many responses include a request_id."
/** The host's request id: 32 hex digits, drawn from the request and its moment. */
export const requestId = (ctx: HandlerContext): string => ctx.crypto.md5(`${ctx.occurredAt}:${ctx.call.request.url}`);

/** The account a request's `WLT-Api-Key` opens, or the host's 401 (spec/SOURCE.md). */
// source: spec:/components/securitySchemes/ApiKeyAuth "API key for authentication. Get your key from the developer portal."
export function accountOf(ctx: HandlerContext): Row | Response {
  const key = ctx.call.request.headers.get('wlt-api-key')?.trim();
  // Where the documentation stops: SOURCE.md reports the gateway's 2026-09-30 401 observations,
  // but the published spec does not define that envelope or its trace-id format. Retain those observed refusals.
  if (!key) return Response.json({ message: 'No API key found in request', request_id: requestId(ctx) }, { status: 401 });
  const hash = sha256(ctx, key);
  const credential = ctx.rowsRaw('_api_key').find((row) => row.revoked !== true && row.key_sha256 === hash);
  return (credential ? ctx.row(ACCOUNT, String(credential.account_id)) : ctx.rowsRaw(ACCOUNT).find((row) => row.key_sha256 === hash)) ?? Response.json({ message: 'Unauthorized', request_id: requestId(ctx) }, { status: 401 });
}

// The kernel validates the top-level body. These are the World API-specific union/enum and nested filter rules.
// Where the documentation stops: the spec documents the validation envelope, not each Pydantic msg/type string.
type ValidationDetail = { loc: (string | number)[]; msg: string; type: string; input: unknown; ctx?: Record<string, number> };
const invalidFilter = (name: string, input: unknown, type: string, msg: string): ValidationDetail => ({ loc: ['body', name], input, type, msg });
const invalidItem = (input: unknown, index: number): ValidationDetail => ({ loc: ['body', 'tags', index], input, type: 'string_type', msg: 'Input should be a valid string' });
const invalidDate = (name: string, input: unknown): ValidationDetail => invalidFilter(name, input, 'datetime_from_date_parsing', 'Input should be a valid datetime');
const integerError = (input: unknown): ValidationDetail => invalidFilter('page_size', input, 'int_parsing', 'Input should be a valid integer');
const sizeLow = (input: unknown): ValidationDetail => ({ ...invalidFilter('page_size', input, 'greater_than_equal', 'Input should be greater than or equal to 1'), ctx: { ge: 1 } });
const sizeHigh = (input: unknown): ValidationDetail => ({ ...invalidFilter('page_size', input, 'less_than_equal', 'Input should be less than or equal to 100'), ctx: { le: 100 } });

export function listFilterErrors(body: unknown): ValidationDetail[] {
  // Non-object bodies are the kernel's ctx.validate() refusal, without normalization into an empty request.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const b = body as Record<string, unknown>;
  const errors: ValidationDetail[] = [];
  // source: spec:/components/schemas/ListWorldsRequest "Number of results per page (1-100)"
  const size = b.page_size === undefined ? 20 : b.page_size;
  if (typeof size !== 'number' || !Number.isInteger(size)) errors.push(integerError(size));
  else if (size < 1) errors.push(sizeLow(size));
  else if (size > 100) errors.push(sizeHigh(size));
  // source: spec:/components/schemas/ListWorldsRequest "Sort results by created_at or updated_at"
  // source: spec:/components/schemas/ListWorldsRequest "Filter by world status"
  // source: spec:/components/schemas/ListWorldsRequest "Filter by model used for generation. Legacy names are deprecated; use the new lowercase names."
  const enums: Record<string, string[]> = { sort_by: ['created_at', 'updated_at'], status: ['SUCCEEDED', 'PENDING', 'FAILED', 'RUNNING'], model: ['marble-1.0-draft', 'marble-1.0', 'marble-1.1', 'marble-1.1-plus', 'Marble 0.1-mini', 'Marble 0.1-plus', 'Marble 1.1-plus'] };
  for (const [name, allowed] of Object.entries(enums)) {
    const value = b[name];
    if (value === undefined || (value === null && name !== 'sort_by')) continue;
    if (!allowed.includes(String(value)) || typeof value !== 'string') errors.push(invalidFilter(name, value, 'literal_error', `Input should be ${allowed.join(' or ')}`));
  }
  // source: spec:/components/schemas/ListWorldsRequest "Cursor token for pagination (opaque base64 string from previous response). Use cursor from next_page_token in previous response for consistent pagination."
  if (b.page_token !== undefined && b.page_token !== null && typeof b.page_token !== 'string') errors.push(invalidFilter('page_token', b.page_token, 'string_type', 'Input should be a valid string'));
  // source: spec:/components/schemas/ListWorldsRequest "Filter by visibility. true=public only, false=private only, null=all"
  if (b.is_public !== undefined && b.is_public !== null && typeof b.is_public !== 'boolean') errors.push(invalidFilter('is_public', b.is_public, 'bool_parsing', 'Input should be a valid boolean'));
  // source: spec:/components/schemas/ListWorldsRequest "Filter by tags (returns worlds with ANY of these tags)"
  if (b.tags !== undefined && b.tags !== null) {
    if (!Array.isArray(b.tags)) errors.push(invalidFilter('tags', b.tags, 'list_type', 'Input should be a valid list'));
    else b.tags.forEach((value, index) => { if (typeof value !== 'string') errors.push(invalidItem(value, index)); });
  }
  // source: spec:/components/schemas/ListWorldsRequest "Filter worlds created after this timestamp (inclusive)"
  // source: spec:/components/schemas/ListWorldsRequest "Filter worlds created before this timestamp (exclusive)"
  for (const name of ['created_after', 'created_before']) {
    const value = b[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/.test(value) || !Number.isFinite(Date.parse(value))) errors.push(invalidDate(name, value));
  }
  return errors;
}
