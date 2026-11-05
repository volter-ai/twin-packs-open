// The account's balance: what the key's account holds, in Tripo's envelope (`code` 0 and its `data`).
import type { HandlerContext } from '@volter/world-core';
import { accountOf, balanceHost, frontNotFound } from './shared.ts';

// source: spec:getBalance "Get the user's account balance."
export async function getBalance(ctx: HandlerContext): Promise<Response> {
  // source: spec:/paths/~1v2~1openapi~1user~1balance/get/servers "https://api.tripo3d.ai"
  if (!balanceHost(ctx)) return frontNotFound();
  const a = accountOf(ctx)!;
  // source: spec:getBalance "Frozen amount"
  return Response.json({ code: 0, data: { balance: a.balance, frozen: a.frozen } });
}
