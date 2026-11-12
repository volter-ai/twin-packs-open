// The World's doors: what Axiom's console does that its API does not.
//
//   POST /_twin/app-credentials   the account's sign-up: the dataset the application ingests into (`logs`) and a basic
//                                  API token with ingest access to it, the same at every boot (the descriptor's
//                                  credentialDoor)
import type { HandlerContext } from '@volter/world-core';
import { basicToken, makeDataset } from './shared.ts';

// source: https://axiom.co/docs/reference/tokens "When you create a basic API token, you select the datasets that you allow the basic API token to access."
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const name = 'logs';
  const dataset = await makeDataset(ctx, name, 'World');
  const token = await basicToken(ctx, `world-app:${name}`, [name]);
  return Response.json({ token, dataset: dataset.name }, { status: 201 });
}
