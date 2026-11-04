// What every lane of AWS shares (S3, Secrets Manager), its credentials: an IAM user's access keys, each an Access Key ID
// (`AKIA` and sixteen letters and digits) and a Secret Access Key (forty characters), as the IAM console's "Create access
// key" shows them once (https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html). The World
// keeps the Access Key ID (`_access_key`); the secret is drawn from a secret the World holds for it (ctx.secret), so it
// is kept nowhere and no one computes it from the id. Every request is verified by its SigV4 signature (the kernel's
// verifySigV4): signed by an issued key, or refused as the lane's API refuses it.
import { sha256, verifySigV4, type HandlerContext, type SigV4Verdict } from '@volter/world-core';

export const ACCESS_KEY = '_access_key';

/** The default AWS account's twelve-digit identity. */
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

export const accountId = (ctx: Pick<HandlerContext, 'rowsRaw' | 'call'>): string => {
  const key = ctx.rowsRaw(ACCESS_KEY).find((row) => row.id === accessKeyId(ctx.call.request));
  return typeof key?.account_id === 'string' ? key.account_id : accountNumber(worldAccountOf(ctx));
};

/** The IAM user whose access key signed a request (its Authorization header's or presigned URL's credential), as an ARN
 *  (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns), or undefined when the
 *  key is not one the World issued to a user. */
// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html "arn:aws:iam::123456789012:user/John"
export function signerArn(ctx: Pick<HandlerContext, 'rowsRaw'>, request: Request): string | undefined {
  const keyId = accessKeyId(request);
  const held = ctx.rowsRaw(ACCESS_KEY).find((k) => k.id === keyId && k.deleted !== true);
  const account = typeof held?.account_id === 'string' ? held.account_id : accountNumber(String(held?._world_account ?? 'default'));
  // a role session's key names its session under the role (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-arns)
  return held?.role ? `arn:aws:sts::${account}:assumed-role/${String(held.role)}/${String(held.session)}` : held?.user ? `arn:aws:iam::${account}:user/${String(held.user)}` : undefined;
}

/** An access key's Secret Access Key: forty characters drawn from the World's secret for its id. */
async function secretAccessKey(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, keyId: string): Promise<string> {
  return ctx.crypto.base62From(await ctx.secret(`aws-secret-access-key:${keyId}`), 40);
}

/** The secret of an access key the World issued and has not deactivated, or undefined. */
async function issuedSecret(ctx: Pick<HandlerContext, 'secret' | 'crypto' | 'rowsRaw'>, keyId: string): Promise<string | undefined> {
  const held = ctx.rowsRaw(ACCESS_KEY).find((k) => k.id === keyId && k.deleted !== true && k.status !== 'Inactive');
  if (!held) return undefined;
  const secret = await secretAccessKey(ctx, keyId);
  return held._secret_sha256 === undefined || held._secret_sha256 === ctx.crypto.sha256(secret) ? secret : undefined;
}

/** Whether a request is signed by an issued key: its SigV4 verdict, at the World's instant. */
export const signedBy = (ctx: Pick<HandlerContext, 'secret' | 'crypto' | 'rowsRaw' | 'occurredAt'>, request: Request, body: Uint8Array | string | undefined): Promise<SigV4Verdict> =>
  verifySigV4(request, body, (keyId) => issuedSecret(ctx, keyId), Date.parse(ctx.occurredAt));

/** Native IAM names are account-unique and case insensitive. */
// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html
async function principal(ctx: HandlerContext, account: string, type: '_iam_user' | '_iam_role', label: string, identity: string): Promise<string> {
  const rule = { max: 64, allowed: /[A-Za-z0-9+=,.@_-]/ };
  for (const suffixed of [false, true]) {
    const name = ctx.vendorName(label, rule, { suffixed, identity });
    const made = await ctx.createUnique(type, { account_id: account, name, _name: name.toLowerCase(), arn: `arn:aws:iam::${account}:${type === '_iam_user' ? 'user' : 'role'}/${name}` }, `${type.slice(1)}.create`, { input: 'omit' });
    if (made.created) return String(made.row.id);
  }
  throw ctx.refuse({ status: 409, code: 'EntityAlreadyExists', message: `An IAM ${type === '_iam_user' ? 'user' : 'role'} already exists for ${identity}.` });
}

/** A workload's IAM access key, or an explicitly requested IAM user/STS role session's credentials. */
// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
// source: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html
export async function issueAppCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const organization = await ctx.account();
    const account = await ctx.tenant('_aws_account', async (world) => {
      const fields = { name: world.label, email: world.members[0]!.toLowerCase(), _world_account: world.id };
      return world.id === 'default' ? ctx.record('_aws_account', fields, ACCOUNT_ID)
        : String((await ctx.create('_aws_account', fields, 'account.create')).id);
    });
    const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {}) as Record<string, unknown>;
    const role = typeof body.role === 'string' ? body.role : undefined;
    const user = typeof body.user === 'string' ? body.user : undefined;
    const session = typeof body.session === 'string' ? body.session : role;
    const identity = ctx.deployment() ? `${organization}/${ctx.deployment()}` : organization;
    let owner: Record<string, unknown>;
    if (role) {
      const iamRole = await ctx.deploymentObject(`iam-role:${account.id}:${role}`, '_iam_role', () => principal(ctx, String(account.id), '_iam_role', role, identity));
      const sessionName = ctx.vendorName(session ?? String(iamRole.name), { max: 64, allowed: /[A-Za-z0-9+=,.@_-]/ }, { identity });
      const assumed = await ctx.deploymentObject(`role-session:${iamRole.id}:${session}`, '_role_session', async () => String((await ctx.create('_role_session', {
        account_id: account.id, role_id: iamRole.id, role: iamRole.name, session: sessionName,
      }, 'role_session.create')).id));
      owner = { id: assumed.id, role: iamRole.name, session: assumed.session };
    } else {
      const iamUser = await ctx.deploymentObject(`iam-user:${account.id}:${user ?? 'workload'}`, '_iam_user', () =>
        principal(ctx, String(account.id), '_iam_user', user ?? (ctx.deployment() || organization), identity));
      owner = { id: iamUser.id, user: iamUser.name };
    }
    const key = await ctx.accountKey(`access-key:${owner.id}`, ACCESS_KEY, {
      make: async () => {
        const reservation = await ctx.issue('_access_identity');
        const id = `${role ? 'ASIA' : 'AKIA'}${ctx.crypto.base62From(reservation, 16).toUpperCase()}`;
        const principalFields = role ? { role: owner.role, session: owner.session } : { user: owner.user };
        await ctx.record(ACCESS_KEY, { ...principalFields, _owner: owner.id, account_id: account.id, _world_account: organization, status: 'Active', created: ctx.occurredAt }, id);
        const value = await secretAccessKey(ctx, id);
        await ctx.record(ACCESS_KEY, { _secret_sha256: ctx.crypto.sha256(value) }, id);
        return id;
      },
      read: async (row) => row._owner === owner.id && row.account_id === account.id ? issuedSecret(ctx, String(row.id)) : undefined,
    });
    const token = role ? { session_token: ctx.crypto.base62From(await ctx.secret(`aws-session-token:${key.id}`), 64) } : {};
    return Response.json({ access_key_id: key.id, secret_access_key: key.secret, ...token, region: 'us-east-1' }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
