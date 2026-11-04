// What the api lane shares: the vendor's store and lists (../../../src/semantics/shared.ts), and how Firebase answers.
import type { HandlerContext } from '@volter/world-core';

export * from '../../../src/semantics/shared.ts';

/** A value as Firebase's REST API answers a read: JSON, indented when `print=pretty` asks. */
// source: https://firebase.google.com/docs/reference/rest/database "A successful request is indicated by a 200 OK HTTP status code. The response contains the data associated with the path in the GET request."
// source: https://firebase.google.com/docs/reference/rest/database "View the data in a human-readable format."
// Where the documentation stops: Firebase does not say how it indents; the twin indents by two spaces.
export function answer(ctx: HandlerContext, value: unknown): Response {
  const pretty = String(ctx.params.print ?? '') === 'pretty';
  return ctx.raw(pretty ? JSON.stringify(value ?? null, null, 2) : JSON.stringify(value ?? null), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
