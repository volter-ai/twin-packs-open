// The account's worlds, listed: the key test's read. The World generates none (generation is not demand), so a list
// is the account's worlds as the store holds them.
import type { HandlerContext } from '@volter/world-core';
import { accountOf, listFilterErrors } from './shared.ts';

// source: spec:list_worlds_marble_v1_worlds_list_post "Returns worlds created through the API with optional filtering and pagination."
export async function list_worlds_marble_v1_worlds_list_post(ctx: HandlerContext): Promise<Response> {
  const a = accountOf(ctx);
  if (a instanceof Response) return a;
  // source: spec:/components/schemas/HTTPValidationError "detail"
  const errors = listFilterErrors(ctx.body);
  if (errors.length) return Response.json({ detail: errors }, { status: 422 });
  const invalid = ctx.validate();
  if (invalid) return invalid;
  // source: spec:/components/schemas/ListWorldsResponse "Token for fetching the next page of results"
  // This scope has no generation or stored vendor worlds: every issued key starts with an empty account.
  return Response.json({ worlds: [], next_page_token: null });
}
