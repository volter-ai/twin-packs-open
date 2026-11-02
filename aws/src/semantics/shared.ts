// What every lane of AWS shares (S3, Secrets Manager), its credentials: an IAM user's access keys, each an Access Key ID
// (`AKIA` and sixteen letters and digits) and a Secret Access Key (forty characters), as the IAM console's "Create access
// key" shows them once (https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html). The World
// keeps the Access Key ID (`_access_key`); the secret is drawn from a secret the World holds for it (ctx.secret), so it
// is kept nowhere and no one computes it from the id. Every request is verified by its SigV4 signature (the kernel's
// verifySigV4): signed by an issued key, or refused as the lane's API refuses it.
import { sha256, verifySigV4, type HandlerContext, type SigV4Verdict } from '@volter/world-core';

export const ACCESS_KEY = '_access_key';

/** The legacy default account keeps its existing twelve-digit identity. */
const ACCOUNT_ID = '000000000000';

/** A named World's AWS account uses AWS's twelve-digit account form, stable across its credentials. */
const accountNumber = (account: string): string => account === 'default' ? ACCOUNT_ID
  : String(100_000_000_000n + BigInt(`0x${sha256(account)}`) % 900_000_000_000n);

export const accessKeyId = (request: Request): string | undefined =>
  /Credential=([^/,\s]+)\//.exec(request.headers.get('authorization') ?? '')?.[1]
  ?? new URL(request.url).searchParams.get('X-Amz-Credential')?.split('/')[0];

/** The selected signer's World account, after the kernel has isolated its credential namespace. */
export function worldAccountOf(ctx: Pick<HandlerContext, 'rowsRaw' | 'call'>): string {
  const held = ctx.rowsRaw(ACCESS_KEY).find(k => k.id === accessKeyId(ctx.call.request));
  return String(held?._world_account ?? 'default');
}

export const accountId = (ctx: Pick<HandlerContext, 'rowsRaw' | 'call'>): string => accountNumber(worldAccountOf(ctx));

/** The IAM user whose access key signed a request (its Authorization header's or presigned URL's credential), as an ARN
 *  (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns), or undefined when the
 *  key is not one the World issued to a user. */
// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html "arn:aws:iam::123456789012:user/John"
export function signerArn(ctx: Pick<HandlerContext, 'rowsRaw'>, request: Request): string | undefined {
  const keyId = accessKeyId(request);
  const held = ctx.rowsRaw(ACCESS_KEY).find((k) => k.id === keyId && k.deleted !== true);
  const account = accountNumber(String(held?._world_account ?? 'default'));
  // a role session's key names its session under the role (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns)
  return held?.role ? `arn:aws:sts::${account}:assumed-role/${String(held.role)}/${String(held.session)}` : held?.user ? `arn:aws:iam::${account}:user/${String(held.user)}` : undefined;
}

/** An access key's Secret Access Key: forty characters drawn from the World's secret for its id. */
export async function secretAccessKey(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, keyId: string): Promise<string> {
  return ctx.crypto.base62From(await ctx.secret(`aws-secret-access-key:${keyId}`), 40);
}

/** The secret of an access key the World issued and has not deactivated, or undefined. */
async function issuedSecret(ctx: Pick<HandlerContext, 'secret' | 'crypto' | 'rowsRaw'>, keyId: string): Promise<string | undefined> {
  const held = ctx.rowsRaw(ACCESS_KEY).find((k) => k.id === keyId && k.deleted !== true && k.status !== 'Inactive');
  return held ? secretAccessKey(ctx, keyId) : undefined;
}

/** Whether a request is signed by an issued key: its SigV4 verdict, at the World's instant. */
export const signedBy = (ctx: Pick<HandlerContext, 'secret' | 'crypto' | 'rowsRaw' | 'occurredAt'>, request: Request, body: Uint8Array | string | undefined): Promise<SigV4Verdict> =>
  verifySigV4(request, body, (keyId) => issuedSecret(ctx, keyId), Date.parse(ctx.occurredAt));

/** POST /_twin/app-credentials: the access key the World's application holds (the descriptor's credentialDoor), an IAM
 *  user's, made the first time the runtime asks and the same at every boot after. With `{ user }` in its body, the access
 *  key of that IAM user (a person's, made in the IAM console as the application's is); with `{ role, session? }`, the
 *  temporary credentials of a session of that role, as STS answers them to a service that runs under it: an `ASIA` key,
 *  its secret and a session token, the session named for the role unless one is given; a session's key is its own, the
 *  same at every ask for that session. */
// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html "temporary security credentials"
export async function issueAppCredentials(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  const scope = account === 'default' ? '' : `:${account}`;
  const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {}) as Record<string, unknown>;
  const role = typeof body.role === 'string' ? body.role : undefined;
  const person = typeof body.user === 'string' ? body.user : undefined;
  const session = role ? (typeof body.session === 'string' ? body.session : role) : undefined;
  // each session of a role its own temporary key: a service gets a fresh one each time it starts
  const letters = ctx.crypto.base62From(await ctx.secret(role ? `aws-role-session-key-id:${role}:${session}${scope}` : person ? `aws-user-access-key-id:${person}${scope}` : `aws-app-access-key-id${scope}`), 16).toUpperCase();
  const keyId = `${role ? 'ASIA' : 'AKIA'}${letters.slice(0, 16)}`;
  // the IAM user it belongs to is named from the World's secret, as the key is: a name no id the World shows derives
  // source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html "arn:aws:iam::123456789012:user/John"
  const user = role ? undefined : person ?? `app-${(await ctx.secret(`aws-app-iam-user${scope}`)).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
  const owner: { role?: string; session?: string; user?: string } = role ? { role, session } : { user };
  const held = ctx.rowsRaw(ACCESS_KEY).find((k) => k.id === keyId);
  if (!held || held.user !== owner.user || held.role !== owner.role) await ctx.record(ACCESS_KEY, { ...owner, _world_account: account, status: held?.status ?? 'Active', created: held?.created ?? ctx.occurredAt }, keyId);
  const token = role ? { session_token: ctx.crypto.base62From(await ctx.secret(`aws-session-token:${keyId}`), 64) } : {};
  return Response.json({ access_key_id: keyId, secret_access_key: await secretAccessKey(ctx, keyId), ...token, region: 'us-east-1' }, { status: 201 });
}
