import type { HandlerContext } from '@volter/world-core';
import { WIRE_HEADER, answer, wireKey, type Ejson } from './shared.ts';
import type { SingleMemberHandshake } from '../engine/replica-handshake.ts';

// The capability is local to the stream and cannot be a vendor credential or a public mutation door.
// source: recording:hello.json "maxWireVersion"
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (ctx.call.request.method !== 'POST' || ctx.call.request.headers.get(WIRE_HEADER) !== wireKey()) return next();
  const input = await ctx.call.request.json() as { database: string; command: Ejson; replicaSet?: SingleMemberHandshake };
  // One wire command's writes as one group (world-core ctx.batch): an insert of many documents, an index set, an
  // update's statements land in one append, each still its own write; reads inside the command see them as before.
  return Response.json(await ctx.batch(() => answer(ctx, input.database, input.command, input.replicaSet)));
}
