// Durable Object namespaces: made by a Worker's upload as its migrations name its classes (./worker-script.ts), listed
// by the account.
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, accountOf, listed, NAMESPACE, noAccount } from './shared.ts';

/** `GET /accounts/{account_id}/workers/durable_objects/namespaces`: the account's namespaces, each its id, name, script,
 *  class and whether it stores in SQLite. */
// source: spec:durable-objects-namespace-list-namespaces "Returns the Durable Object namespaces owned by an account."
export async function durable_objects_namespace_list_namespaces(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const rows = ctx.rowsRaw(NAMESPACE).filter((n) => sameAccount(ctx, n.account_id, account.id) && n.deleted !== true)
    .map((n) => ({ id: n.id, name: n.name, script: n.script, class: n.class, use_sqlite: n.use_sqlite === true }));
  return listed(ctx, rows, 1000);
}
