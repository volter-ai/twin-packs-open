// The World's door (GET /_twin/rotation-invocations?secret=<id>[&step=<Step>]): the invocations Secrets Manager would have
// sent a secret's rotation function, newest first. Secrets Manager rotates a secret by invoking its function once per
// step, each time with { Step, SecretId, ClientRequestToken, RotationToken }
// (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda.html); no World runs the function, so the
// twin keeps each invocation (`_invocations`) and the function's steps read their event here.
import type { HandlerContext } from '@volter/world-core';
import { answer, find, type Row, S } from './shared.ts';

/** The door, declared in the manifest's `doors`. */
export async function rotationInvocations(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const secretId = url.searchParams.get('secret') ?? '';
  const step = url.searchParams.get('step') ?? undefined;
  const row = find(ctx, secretId);
  if (!row) return ctx.notFound(S, secretId);
  const events = ((row._invocations as Row[] | undefined) ?? []).filter((e) => step === undefined || e.Step === step).reverse();
  return answer(ctx, { Invocations: events });
}
