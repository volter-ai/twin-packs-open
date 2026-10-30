// The Users family: Get Users, as the simulated viewers (the broadcaster's id by login, the viewer's own by the token),
// the installed customer entry and the channel page read accounts.
import type { HandlerContext } from '@volter/world-core';
import { callerOf, dataAnswer, queryValues, twitchError, userById, userByLogin, userView } from './shared.ts';

export async function getUsers(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const ids = queryValues(ctx, 'id');
  const logins = queryValues(ctx, 'login');
  // source: spec:getUsers "the request returns information about the user in the access token if you specify a user access token."
  if (!ids.length && !logins.length) {
    // source: spec:/paths/~1users/get/responses/400/description "query parameter is required unless the request uses a user access token."
    if (!caller.userId) return twitchError(400, 'The id or login query parameter is required unless the request uses a user access token.');
    ids.push(caller.userId);
  }
  const found = [...ids.map((id) => userById(ctx, id)), ...logins.map((login) => userByLogin(ctx, login))]
    .filter((u, i, all) => u !== undefined && all.findIndex((v) => v?.id === u.id) === i);
  // source: spec:getUsers "you must use a user access token that includes the user:read:email scope."
  const emailFor = (id: unknown): boolean => caller.kind === 'user' && caller.userId === id && caller.scopes.includes('user:read:email');
  return dataAnswer(found.map((u) => userView(u!, emailFor(u!.id))));
}
