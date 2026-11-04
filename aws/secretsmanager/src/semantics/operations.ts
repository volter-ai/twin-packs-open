// Secrets Manager semantics, by operation. A secret is kept in DescribeSecret's shape under its ARN, in
// the Region the ARN names; its versions (`_versions`: id, staging labels, value, dates) and resource policy
// (`_policy`) are bookkeeping on it. The Region a request is made in is its signature's credential
// scope, so one World holds a secret and its replicas side by side.
//
// A secret's value is the version carrying AWSCURRENT: a new current version hands AWSPREVIOUS to the
// one it replaces (docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html#term_version).
// Rotation's work is a Lambda function's, which no World runs: RotateSecret configures rotation and,
// when it rotates at once, labels a new version AWSPENDING that stays empty until that function would
// have filled it.
import { type HandlerContext } from '@volter/world-core';
import { accountId, answer, closing, due, find, invoke, kept, mintVersion, next, now, regionOf, regionOfArn, type Row, S, save, scheduleFor, scheduleOf, stage, STEPS, type Version, versionStages, versionsOf } from './shared.ts';

type Tag = { Key: string; Value: string };

const invalid = (ctx: HandlerContext, code: string, message: string): Response => ctx.refuse({ status: 400, code, message });

const input = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? (ctx.body as Row) : {});

// what the tree adds to a stored row: no answer carries it
const KERNEL = ['id', 'type', 'updatedAt', 'deleted'];

const tagsOf = (row: Row): Tag[] => (row.Tags as Tag[] | undefined) ?? [];

/** AWS stamps LastAccessedDate to the day. */
// source: spec:/shapes/com.amazonaws.secretsmanager#SecretVersionsListEntry/members/LastAccessedDate "resolution of this field is at the date level"
const day = (ctx: HandlerContext): number => Math.floor(now(ctx) / 86_400) * 86_400;

/** A rotation schedule's next date: the end of the window it rotates in, as NextRotationDate is "the latest date that
 *  rotation will occur" (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html#rotate-secrets_rotation-windows,
 *  docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html, whose example ends its 16:00 window
 *  of Duration 2h at 17:59:59). A schedule in days counts from the secret's previous rotation, and a new value stored by
 *  PutSecretValue or UpdateSecret "is considered a valid rotation" (docs.aws.amazon.com/secretsmanager/latest/apireference/API_RotationRulesType.html,
 *  AutomaticallyAfterDays); a cron schedule's next window is the next it matches. */
// source: spec:/shapes/com.amazonaws.secretsmanager#DescribeSecretResponse/members/NextRotationDate "latest date that rotation will occur"
const nextRotation = (ctx: HandlerContext, rules: unknown, from = now(ctx)): number => {
  const s = scheduleFor(rules);
  return closing(s, due(s, from, now(ctx)));
};

/** A new value is a rotation: the schedule counts on from it. */
// source: spec:/shapes/com.amazonaws.secretsmanager#RotationRulesType/members/AutomaticallyAfterDays "is considered a valid rotation"
const rotatedNow = (ctx: HandlerContext, row: Row): Row => ({
  _rotatedAt: now(ctx),
  ...(row.RotationEnabled === true ? { NextRotationDate: nextRotation(ctx, row.RotationRules) } : {}),
});

/** A token that is already a version: the same value is a retry, answered with that version again; another value is
 *  refused, as a version's value never changes. */
function retriedVersion(ctx: HandlerContext, p: Row, had: Version, versions: Version[], id: string): { versions: Version[]; id: string; stages: string[]; retried: boolean } | Response {
// source: spec:/shapes/com.amazonaws.secretsmanager#PutSecretValue "This operation is idempotent."
  if (had.SecretString !== p.SecretString || had.SecretBinary !== p.SecretBinary) return invalid(ctx, 'ResourceExistsException', `You can't modify an existing version, you can only create a new version.`);
  return { versions, id, stages: had.VersionStages, retried: true };
}

/** A replica Region where a secret of the name already stands, and the caller did not ask to overwrite it. */
function nameTaken(entry: Row): Row {
  return { ...entry, Status: 'Failed', StatusMessage: `Replication failed: Secret name already exists in Region ${String(entry.Region)}.` };
}

/** A new version holding a value, current unless the caller labels it otherwise. A retried request
 *  (its ClientRequestToken already a version) answers that version again when the value is the same. */
async function withValue(ctx: HandlerContext, row: Row, p: Row): Promise<{ versions: Version[]; id: string; stages: string[]; retried: boolean } | Response> {
  const versions = versionsOf(row);
  const id = typeof p.ClientRequestToken === 'string' ? p.ClientRequestToken : await mintVersion(ctx);
  const had = versions.find((v) => v.VersionId === id);
  // a rotation's version Secrets Manager made before its function stored anything in it ("During rotation, Secrets
  // Manager creates an AWSPENDING version ID before creating the new secret version", API_DescribeSecret.html,
  // VersionIdsToStages) takes the value the function stores under its token
  const empty = had !== undefined && had.SecretString === undefined && had.SecretBinary === undefined;
  if (had && !empty) return retriedVersion(ctx, p, had, versions, id);
// source: spec:/shapes/com.amazonaws.secretsmanager#PutSecretValue "then Secrets Manager automatically moves the staging label"
  const stages = Array.isArray(p.VersionStages) ? (p.VersionStages as string[]) : ['AWSCURRENT'];
  let next: Version[] = [...versions.filter((v) => v.VersionId !== id), { ...(had ?? {}), VersionId: id, VersionStages: [], CreatedDate: now(ctx), ...(p.SecretString !== undefined ? { SecretString: String(p.SecretString) } : {}), ...(p.SecretBinary !== undefined ? { SecretBinary: String(p.SecretBinary) } : {}) }];
  for (const label of stages) next = stage(next, label, id);
  return { versions: next, id, stages, retried: false };
}

/** A secret a write may change: it exists here, and is its own primary. */
function writable(ctx: HandlerContext, p: Row): Row | Response {
  const row = find(ctx, p.SecretId);
  if (!row) return ctx.notFound(S, String(p.SecretId));
  if (row.PrimaryRegion && row.PrimaryRegion !== regionOfArn(row.ARN)) return invalid(ctx, 'InvalidRequestException', "Operation not permitted on a replica secret. Call must be made in primary secret's region.");
  return row;
}

/** The replicas a primary keeps: each a copy in its Region under the primary's ARN there, unless a secret
 *  of that name is there already and the caller did not ask to overwrite it. */
async function replicate(ctx: HandlerContext, primary: Row, regions: Array<{ Region: string; KmsKeyId?: string }>, overwrite: boolean): Promise<Array<Row>> {
  const status = [...((primary.ReplicationStatus as Row[] | undefined) ?? [])];
  const home = regionOfArn(primary.ARN);
  for (const { Region, KmsKeyId } of regions) {
    const there = find(ctx, primary.Name, Region);
    const entry: Row = { Region, KmsKeyId: KmsKeyId ?? 'alias/aws/secretsmanager' };
// source: spec:/shapes/com.amazonaws.secretsmanager#ReplicateSecretToRegionsRequest/members/ForceOverwriteReplicaSecret "By default, secrets aren't overwritten."
    if (there && !overwrite) { status.push(nameTaken(entry)); continue; }
    const arn = String(primary.ARN).replace(`:${home}:`, `:${Region}:`);
    // "Secrets Manager replicates the encrypted secret data and metadata such as tags and resource policies"
    // (docs.aws.amazon.com/secretsmanager/latest/userguide/create-manage-multi-region-secrets.html)
    const copy = { ...Object.fromEntries(Object.entries(primary).filter(([k]) => ![...KERNEL, 'ReplicationStatus'].includes(k))), ARN: arn, KmsKeyId: entry.KmsKeyId, PrimaryRegion: home, _replicatedAt: now(ctx) };
    // an overwritten secret is replaced by the replica, not changed into it
    if (there) await ctx.write(S, String(there.id), { deleted: true }, 'secret.delete');
    await ctx.write(S, arn, copy, 'secret.replicate');
    // a new replica is being made when the call answers (docs.aws.amazon.com/secretsmanager/latest/apireference/API_ReplicateSecretToRegions.html,
    // whose example answers InProgress; API_CreateSecret.html: "InProgress, which indicates that Secrets Manager is in the
    // process of creating the replica")
    status.push({ ...entry, Status: 'InProgress' });
  }
  return status;
}

/** DescribeSecret's answer for a stored secret. */
function describe(ctx: HandlerContext, row: Row): Row {
  // a date that was cleared (a restored secret's DeletedDate) is absent, as AWS omits it
  const out: Row = Object.fromEntries(Object.entries(ctx.own(row)).filter(([k, v]) => !k.startsWith('_') && v !== null));
  return out;
}

/** A version's staging labels as an answer carries them: absent when it has none, as every answer's VersionStages is
 *  "Array Members: Minimum number of 1 item" (docs.aws.amazon.com/secretsmanager/latest/apireference/API_SecretVersionsListEntry.html,
 *  API_GetSecretValue.html, API_PutSecretValue.html). */
// source: spec:/shapes/com.amazonaws.secretsmanager#SecretVersionsListEntry/members/VersionStages "An array of staging labels that are currently associated with this version of the secret."
const stagesOf = (stages: string[]): Row => (stages.length ? { VersionStages: stages } : {});

/** The value a version holds, as GetSecretValue and BatchGetSecretValue answer it. */
const valueOf = (row: Row, v: Version): Row => ({ ARN: row.ARN, Name: row.Name, VersionId: v.VersionId, ...(v.SecretString !== undefined ? { SecretString: v.SecretString } : {}), ...(v.SecretBinary !== undefined ? { SecretBinary: v.SecretBinary } : {}), ...stagesOf(v.VersionStages), CreatedDate: v.CreatedDate });

// ListSecrets and BatchGetSecretValue filter by key; a value matches a prefix, or with `!` excludes one
// source: spec:/shapes/com.amazonaws.secretsmanager#Filter "Allows you to add filters when you use the search function in Secrets Manager."
const FILTERS: Record<string, (r: Row) => string[]> = {
  name: (r) => [String(r.Name)],
  description: (r) => [String(r.Description ?? '')],
  'tag-key': (r) => tagsOf(r).map((t) => t.Key),
  'tag-value': (r) => tagsOf(r).map((t) => t.Value),
  'primary-region': (r) => [String(r.PrimaryRegion ?? '')],
  'owning-service': (r) => [String(r.OwningService ?? '')],
  all: (r) => ['name', 'description', 'tag-key', 'tag-value', 'primary-region', 'owning-service'].flatMap((k) => FILTERS[k]!(r)),
};

/** Refuse malformed pagination and filter inputs before slicing or invoking a filter function. */
function listInputError(ctx: HandlerContext, p: Row): Response | undefined {
  // source: spec:/shapes/com.amazonaws.secretsmanager#InvalidNextTokenException "value is invalid."
  if (p.NextToken !== undefined && (typeof p.NextToken !== 'string' || !/^\d+$/.test(p.NextToken) || !Number.isSafeInteger(Number(p.NextToken)))) return invalid(ctx, 'InvalidNextTokenException', 'The NextToken value is invalid.');
  // source: spec:/shapes/com.amazonaws.secretsmanager#InvalidParameterException "The parameter name or value is invalid."
  // The Filter shape enumerates allowed keys; a malformed filter is answered in the exception's own words.
  if (p.Filters !== undefined && (!Array.isArray(p.Filters) || p.Filters.some((f) => !f || typeof f !== 'object' || !Object.hasOwn(FILTERS, f.Key) || !Array.isArray(f.Values) || !f.Values.length || f.Values.some((v: unknown) => typeof v !== 'string')))) return invalid(ctx, 'InvalidParameterException', 'The parameter name or value is invalid.');
  return undefined;
}

// source: spec:/shapes/com.amazonaws.secretsmanager#Filter/members/Values "perform negation filters"
function matches(r: Row, filters: unknown): boolean {
  return ((filters as Array<{ Key: string; Values: string[] }> | undefined) ?? []).every((f) => f.Values.some((v) => {
    const hit = FILTERS[f.Key]!(r).some((s) => s.startsWith(v.replace(/^!/, '')));
    return v.startsWith('!') ? !hit : hit;
  }));
}

/** A page of a list, NextToken being where the next one starts. */
// source: spec:/shapes/com.amazonaws.secretsmanager#ListSecretsRequest/members/MaxResults "The number of results to include in the response."
function page<T>(items: T[], p: Row): { items: T[]; next?: string } {
  const start = Number(p.NextToken ?? 0);
  const size = Number(p.MaxResults ?? 100);
  return { items: items.slice(start, start + size), ...(start + size < items.length ? { next: String(start + size) } : {}) };
}

const CHARS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', numbers: '0123456789', punctuation: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' };

// source: spec:/shapes/com.amazonaws.secretsmanager#BatchGetSecretValue "for up to 20 secrets."
export async function BatchGetSecretValue(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const malformed = listInputError(ctx, p);
  if (malformed) return malformed;
  const named = p.SecretIdList as string[] | undefined;
  const rows = named ? named.map((id) => ({ id, row: find(ctx, id) })) : kept(ctx).filter((r) => regionOfArn(r.ARN) === regionOf(ctx) && !r.DeletedDate && matches(r, p.Filters)).map((row) => ({ id: String(row.Name), row }));
  const SecretValues: Row[] = [];
  const Errors: Row[] = [];
  for (const { id, row } of rows) {
    const v = row && !row.DeletedDate ? versionsOf(row).find((x) => x.VersionStages.includes('AWSCURRENT')) : undefined;
    if (row && v) SecretValues.push(valueOf(row, v));
    else Errors.push({ SecretId: id, ErrorCode: 'ResourceNotFoundException', Message: "Secrets Manager can't find the specified secret." });
  }
  const { items, next } = page(SecretValues, p);
  return answer(ctx, { SecretValues: items, Errors, ...(next ? { NextToken: next } : {}) });
}

// source: spec:/shapes/com.amazonaws.secretsmanager#UpdateSecret "Modifies the details of a secret, including metadata and the secret value."
export async function UpdateSecret(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const row = writable(ctx, p);
  if (row instanceof Response) return row;
  const refusal = row.DeletedDate ? ctx.legal(S, 'DeletedDate', 'UpdateSecret', row.DeletedDate) : undefined;
  if (refusal) return ctx.refuse(refusal);
  const value = p.SecretString !== undefined || p.SecretBinary !== undefined ? await withValue(ctx, row, { ...p, VersionStages: undefined }) : undefined;
  if (value instanceof Response) return value;
  await save(ctx, row, { ...(p.Description !== undefined ? { Description: p.Description } : {}), ...(p.KmsKeyId !== undefined ? { KmsKeyId: p.KmsKeyId } : {}), ...(value ? { _versions: value.versions, ...rotatedNow(ctx, row) } : {}) }, 'secret.update');
  return answer(ctx, { ARN: row.ARN, Name: row.Name, ...(value ? { VersionId: value.id } : {}) });
}

// source: spec:/shapes/com.amazonaws.secretsmanager#ListSecretVersionIds "Lists the versions of a secret."
export async function ListSecretVersionIds(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const malformed = listInputError(ctx, p);
  if (malformed) return malformed;
  const row = find(ctx, p.SecretId);
  if (!row) return ctx.notFound(S, String(p.SecretId));
  // a version no label names is deprecated, and listed only when asked for
// source: spec:/shapes/com.amazonaws.secretsmanager#ListSecretVersionIdsRequest/members/IncludeDeprecated "By default, versions without staging labels aren't included."
  const versions = versionsOf(row).filter((v) => p.IncludeDeprecated === true || v.VersionStages.length).reverse();
  const { items, next } = page(versions, p);
  return answer(ctx, { ARN: row.ARN, Name: row.Name, Versions: items.map(({ SecretString: _s, SecretBinary: _b, VersionStages, ...v }) => ({ ...v, ...stagesOf(VersionStages), KmsKeyIds: [String(row.KmsKeyId ?? 'DefaultEncryptionKey')] })), ...(next ? { NextToken: next } : {}) });
}

// source: spec:/shapes/com.amazonaws.secretsmanager#TagResource "Attaches tags to a secret."
export async function TagResource(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const row = writable(ctx, p);
  if (row instanceof Response) return row;
  const added = (p.Tags as Tag[] | undefined) ?? [];
  await save(ctx, row, { Tags: [...tagsOf(row).filter((t) => !added.some((a) => a.Key === t.Key)), ...added] }, 'secret.tag');
  return answer(ctx, {});
}

// source: spec:/shapes/com.amazonaws.secretsmanager#UntagResource "Removes specific tags from a secret."
export async function UntagResource(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const row = writable(ctx, p);
  if (row instanceof Response) return row;
  const keys = (p.TagKeys as string[] | undefined) ?? [];
  await save(ctx, row, { Tags: tagsOf(row).filter((t) => !keys.includes(t.Key)) }, 'secret.untag');
  return answer(ctx, {});
}

// source: spec:/shapes/com.amazonaws.secretsmanager#CancelRotateSecret "Turns off automatic rotation, and if a rotation is currently in progress, cancels the rotation."
export async function CancelRotateSecret(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const row = writable(ctx, p);
  if (row instanceof Response) return row;
  ctx.legal(S, 'RotationEnabled', 'CancelRotateSecret', row.RotationEnabled, 'false');
  // an unfinished rotation's AWSPENDING version stays labelled, as AWS leaves it
  // with rotation disabled, DescribeSecret answers neither date (docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html)
  await save(ctx, row, { RotationEnabled: false, NextRotationDate: null, LastRotatedDate: null, _rotation: null }, 'secret.cancel_rotation');
  const pending = versionsOf(row).find((v) => v.VersionStages.includes('AWSPENDING'));
  return answer(ctx, { ARN: row.ARN, Name: row.Name, ...(pending ? { VersionId: pending.VersionId } : {}) });
}

// source: spec:/shapes/com.amazonaws.secretsmanager#DeleteResourcePolicy "Deletes the resource-based permission policy attached to the secret."
export async function DeleteResourcePolicy(ctx: HandlerContext): Promise<Response> {
  const p = input(ctx);
  const row = writable(ctx, p);
  if (row instanceof Response) return row;
  await save(ctx, row, { _policy: null }, 'secret.delete_policy');
  return answer(ctx, { ARN: row.ARN, Name: row.Name });
}

/** A rotation's write without its RotationToken: the rotation function assumes its role to call Secrets Manager, which
 *  "validates the identity using the token" (docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html,
 *  RotationToken). AWS documents no wording for the refusal; the twin decides it. */
function rotationTokenRefused(ctx: HandlerContext): Response {
  return ctx.refuse({ status: 400, code: 'AccessDeniedException', message: 'The rotation token is missing or does not match the rotation in progress.' });
}

// source: spec:/shapes/com.amazonaws.secretsmanager#CreateSecret "Creates a new secret."
export async function CreateSecret(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const region = regionOf(ctx);
    const standing = find(ctx, p.Name);
    if (standing?.DeletedDate) return invalid(ctx, 'InvalidRequestException', "You can't create this secret because a secret with this name is already scheduled for deletion.");
    // a retried request (the SDK sends one ClientRequestToken per call) answers the secret it made
    const made = standing && versionsOf(standing).find((v) => v.VersionId === p.ClientRequestToken && v.SecretString === p.SecretString);
    if (made) return answer(ctx, { ARN: standing.ARN, Name: standing.Name, VersionId: made.VersionId });
    if (standing) return invalid(ctx, 'ResourceExistsException', `The operation failed because the secret ${String(p.Name)} already exists.`);
// source: spec:/shapes/com.amazonaws.secretsmanager#CreateSecretRequest/members/Name "Secrets Manager automatically adds a hyphen and six random characters after the secret name at the end of the ARN."
    const suffix = await ctx.issue('_secret_suffix');
    const ARN = `arn:aws:secretsmanager:${region}:${accountId(ctx)}:secret:${String(p.Name)}-${suffix}`;
    const row: Row = { id: ARN, ARN, Name: p.Name, ...(p.Description !== undefined ? { Description: p.Description } : {}), ...(p.KmsKeyId !== undefined ? { KmsKeyId: p.KmsKeyId } : {}), RotationEnabled: false, Tags: (p.Tags as Tag[] | undefined) ?? [], CreatedDate: now(ctx) };
    const value = p.SecretString !== undefined || p.SecretBinary !== undefined ? await withValue(ctx, row, p) : undefined;
    if (value instanceof Response) return value;
    const fields: Row = { ...row, _versions: value?.versions ?? [], VersionIdsToStages: versionStages(value?.versions ?? []) };
    delete fields.id;
    await ctx.write(S, String(row.id), { ...fields, LastChangedDate: row.CreatedDate }, 'secret.create');
    const regions = p.AddReplicaRegions as Array<{ Region: string; KmsKeyId?: string }> | undefined;
    const ReplicationStatus = regions ? await replicate(ctx, { ...fields, id: row.id }, regions, p.ForceOverwriteReplicaSecret === true) : undefined;
    if (ReplicationStatus) await ctx.write(S, String(row.id), { ReplicationStatus, PrimaryRegion: region }, 'secret.replicate');
    return answer(ctx, { ARN, Name: p.Name, ...(value ? { VersionId: value.id } : {}), ...(ReplicationStatus ? { ReplicationStatus } : {}) });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#DescribeSecret "Retrieves the details of a secret."
export async function DescribeSecret(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = find(ctx, p.SecretId);
    return row ? answer(ctx, describe(ctx, row)) : ctx.notFound(S, String(p.SecretId));
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#GetSecretValue "from the specified version of a secret, whichever contains content."
export async function GetSecretValue(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = find(ctx, p.SecretId);
    if (!row) return ctx.notFound(S, String(p.SecretId));
    const refusal = row.DeletedDate ? ctx.legal(S, 'DeletedDate', 'GetSecretValue', row.DeletedDate) : undefined;
    if (refusal) return ctx.refuse(refusal);
// source: spec:/shapes/com.amazonaws.secretsmanager#GetSecretValueRequest/members/VersionStage "Secrets Manager returns the"
    const label = typeof p.VersionStage === 'string' ? p.VersionStage : 'AWSCURRENT';
    const versions = versionsOf(row);
    const v = p.VersionId !== undefined ? versions.find((x) => x.VersionId === p.VersionId) : versions.find((x) => x.VersionStages.includes(label));
    // source: spec:/shapes/com.amazonaws.secretsmanager#GetSecretValueRequest/members/VersionId "the two parameters must refer to the same"
    // source: spec:/shapes/com.amazonaws.secretsmanager#InvalidParameterException "The parameter name or value is invalid."
    if (v && p.VersionId !== undefined && p.VersionStage !== undefined && !v.VersionStages.includes(String(p.VersionStage))) return invalid(ctx, 'InvalidParameterException', 'The parameter name or value is invalid.');
    if (!v || (v.SecretString === undefined && v.SecretBinary === undefined)) {
      return invalid(ctx, 'ResourceNotFoundException', `Secrets Manager can't find the specified secret value for ${p.VersionId !== undefined ? `VersionId: ${String(p.VersionId)}` : `staging label: ${label}`}`);
    }
    if (row.LastAccessedDate !== day(ctx)) await ctx.write(S, String(row.id), { LastAccessedDate: day(ctx), _versions: versions.map((x) => (x.VersionId === v.VersionId ? { ...x, LastAccessedDate: day(ctx) } : x)) }, 'secret.access');
    return answer(ctx, valueOf(row, v));
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#PutSecretValue "Creates a new version of your secret by creating a new encrypted value and attaching it to the secret."
export async function PutSecretValue(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    const refusal = row.DeletedDate ? ctx.legal(S, 'DeletedDate', 'PutSecretValue', row.DeletedDate) : undefined;
    if (refusal) return ctx.refuse(refusal);
    const rotating = row._rotation as Row | undefined;
    if (rotating && p.ClientRequestToken === rotating.ClientRequestToken && p.RotationToken !== rotating.RotationToken) return rotationTokenRefused(ctx);
    const value = await withValue(ctx, row, p);
    if (value instanceof Response) return value;
    if (!value.retried) await save(ctx, row, { _versions: value.versions, ...rotatedNow(ctx, row) }, 'secret.put_value');
    return answer(ctx, { ARN: row.ARN, Name: row.Name, VersionId: value.id, ...stagesOf(value.stages) });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#ListSecrets "Lists the secrets that are stored by Secrets Manager in the Amazon Web Services account, not including secrets that are marked for deletion."
export async function ListSecrets(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const malformed = listInputError(ctx, p);
    if (malformed) return malformed;
    const order = p.SortOrder === 'desc' ? -1 : 1;
    const key = ({ name: 'Name', 'last-changed-date': 'LastChangedDate', 'last-accessed-date': 'LastAccessedDate' } as Record<string, string>)[String(p.SortBy)] ?? 'CreatedDate';
    const listed = kept(ctx)
      .filter((r) => regionOfArn(r.ARN) === regionOf(ctx) && (p.IncludePlannedDeletion === true || !r.DeletedDate) && matches(r, p.Filters))
      .sort((a, b) => order * (String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true })));
    const { items, next } = page(listed, p);
    return answer(ctx, {
      SecretList: items.map((r) => {
        const { VersionIdsToStages, ReplicationStatus: _r, ...entry } = describe(ctx, r);
        return { ...entry, SecretVersionsToStages: VersionIdsToStages };
      }),
      ...(next ? { NextToken: next } : {}),
    });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#UpdateSecretVersionStage "Modifies the staging labels attached to a version of a secret."
export async function UpdateSecretVersionStage(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    const label = String(p.VersionStage);
    // a moved label leaves the version that held it (AWSCURRENT handing it AWSPREVIOUS); a removed one only leaves
    let versions = typeof p.MoveToVersionId === 'string'
      ? stage(versionsOf(row), label, p.MoveToVersionId)
      : versionsOf(row).map((v) => (v.VersionId === p.RemoveFromVersionId ? { ...v, VersionStages: v.VersionStages.filter((s) => s !== label) } : v));
    // a rotation function's finishSecret: moving AWSCURRENT onto the AWSPENDING version of a secret configured for
    // rotation "also removes the AWSPENDING label in the same API call", and the rotation is done
    // (docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html): LastRotatedDate is
    // "the last date and time that Secrets Manager rotated the secret", and the schedule runs on from it
    // (docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html)
// source: spec:/shapes/com.amazonaws.secretsmanager#DescribeSecretResponse/members/LastRotatedDate "The last date and time that Secrets Manager rotated the secret."
    const finished = label === 'AWSCURRENT' && row.RotationEnabled === true && versionsOf(row).some((v) => v.VersionId === p.MoveToVersionId && v.VersionStages.includes('AWSPENDING'));
    if (finished) versions = versions.map((v) => (v.VersionId === p.MoveToVersionId ? { ...v, VersionStages: v.VersionStages.filter((s) => s !== 'AWSPENDING') } : v));
    await save(ctx, row, { _versions: versions, ...(finished ? { LastRotatedDate: now(ctx), _rotatedAt: now(ctx), NextRotationDate: nextRotation(ctx, row.RotationRules), _rotation: null } : {}) }, 'secret.stage');
    return answer(ctx, { ARN: row.ARN, Name: row.Name });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#DeleteSecret "Deletes a secret and all of its versions."
export async function DeleteSecret(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    // a primary with replicas in its stored ReplicationStatus is refused
    // source: spec:/shapes/com.amazonaws.secretsmanager#DeleteSecret "You can't delete a primary secret that is replicated to other Regions."
    if ((row.ReplicationStatus as Row[] | undefined)?.length) return invalid(ctx, 'InvalidRequestException', "You can't delete a primary secret that is replicated to other Regions.");
    const force = p.ForceDeleteWithoutRecovery === true;
    if (force && p.RecoveryWindowInDays !== undefined) return invalid(ctx, 'InvalidParameterException', "You can't use ForceDeleteWithoutRecovery in conjunction with RecoveryWindowInDays.");
    const days = Number(p.RecoveryWindowInDays ?? 30);
    if (days < 7 || days > 30) return invalid(ctx, 'InvalidParameterException', 'The RecoveryWindowInDays value must be between 7 and 30 days (inclusive).');
    const refusal = ctx.legal(S, 'DeletedDate', 'DeleteSecret', row.DeletedDate, 'scheduled');
    if (refusal) return ctx.refuse(refusal);
// source: spec:/shapes/com.amazonaws.secretsmanager#DeleteSecret "There is no guarantee of a specific time after the recovery window for the permanent delete to occur."
    const DeletionDate = now(ctx) + (force ? 0 : days * 86_400);
    await ctx.write(S, String(row.id), { DeletedDate: now(ctx), ...(force ? { deleted: true } : { _deletionDate: DeletionDate }) }, force ? 'secret.delete' : 'secret.schedule_deletion');
    return answer(ctx, { ARN: row.ARN, Name: row.Name, DeletionDate });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#RestoreSecret "Cancels the scheduled deletion of a secret by removing the"
export async function RestoreSecret(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    // restoring a secret that is not scheduled for deletion leaves it as it is
    if (row.DeletedDate) {
      ctx.legal(S, 'DeletedDate', 'RestoreSecret', row.DeletedDate, 'live');
      await ctx.write(S, String(row.id), { DeletedDate: null, _deletionDate: null }, 'secret.restore');
    }
    return answer(ctx, { ARN: row.ARN, Name: row.Name });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#RotateSecret "Configures and starts the asynchronous process of rotating the secret."
export async function RotateSecret(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    // AWSPENDING on a version AWSCURRENT is not on is a rotation still in progress, read from the stored labels
    // source: spec:/shapes/com.amazonaws.secretsmanager#RotateSecret "assumes that a previous rotation request is still in progress and returns an error."
    const unfinished = Object.values((row.VersionIdsToStages as Record<string, string[]> | undefined) ?? {}).some((labels) => labels.includes('AWSPENDING') && !labels.includes('AWSCURRENT'));
    // source: spec:/shapes/com.amazonaws.secretsmanager#InvalidRequestException "A parameter value is not valid for the current state of the"
    if (unfinished) return invalid(ctx, 'InvalidRequestException', 'A parameter value is not valid for the current state of the resource.');
    const lambda = p.RotationLambdaARN ?? row.RotationLambdaARN;
    // source: https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_RotateSecret.html "You tried to enable rotation on a secret that doesn't already have a Lambda function ARN configured"
    // source: spec:/shapes/com.amazonaws.secretsmanager#InvalidRequestException "A parameter value is not valid for the current state of the"
    if (!lambda) return invalid(ctx, 'InvalidRequestException', 'A parameter value is not valid for the current state of the resource.');
    const rules = (p.RotationRules as Row | undefined) ?? (row.RotationRules as Row | undefined) ?? {};
    // a schedule the schedule page forbids is an invalid parameter: "InvalidParameterException: The parameter name or
    // value is invalid" (docs.aws.amazon.com/secretsmanager/latest/apireference/API_RotateSecret.html#API_RotateSecret_Errors);
    // AWS documents no wording, and each refusal says which rule of the schedule page it breaks (shared.ts, "rotation schedules")
    const schedule = scheduleOf(rules);
    if (typeof schedule === 'string') return invalid(ctx, 'InvalidParameterException', schedule);
    ctx.legal(S, 'RotationEnabled', 'RotateSecret', row.RotationEnabled, 'true');
    // the rotation starts now unless the caller waits for the schedule; its function would fill AWSPENDING
// source: spec:/shapes/com.amazonaws.secretsmanager#RotateSecretRequest/members/RotateImmediately "If you don't specify this value, Secrets Manager rotates the secret immediately."
    const pending = p.RotateImmediately !== false ? await withValue(ctx, row, { ClientRequestToken: p.ClientRequestToken, VersionStages: ['AWSPENDING'] }) : undefined;
    if (pending instanceof Response) return pending;
    // a rotation left for the schedule still tests the configuration now: its testSecret step "creates an AWSPENDING
    // version of the secret and then removes it", and the answer names that version, the ClientRequestToken becoming
    // its VersionId (docs.aws.amazon.com/secretsmanager/latest/apireference/API_RotateSecret.html, RotateImmediately
    // and Example 2); a rotation that starts now invokes the function for every step
    const tested = pending?.id ?? (typeof p.ClientRequestToken === 'string' ? p.ClientRequestToken : await mintVersion(ctx));
    const invoked = pending
      ? await invoke(ctx, { ...row, _versions: pending.versions }, now(ctx), STEPS, { ClientRequestToken: pending.id, RotationToken: await ctx.secret(`rotation-token:${await ctx.issue('_rotation')}`) })
      : await invoke(ctx, row, now(ctx), ['test_secret'], { ClientRequestToken: tested, RotationToken: await ctx.secret(`rotation-token:${await ctx.issue('_rotation')}`) });
    await save(ctx, row, { RotationEnabled: true, RotationLambdaARN: lambda, RotationRules: rules, NextRotationDate: nextRotation(ctx, rules, Number(row._rotatedAt ?? row.CreatedDate)), ...invoked, _scheduledAt: now(ctx) }, 'secret.rotate');
    return answer(ctx, { ARN: row.ARN, Name: row.Name, VersionId: pending ? pending.id : tested });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#GetRandomPassword "Generates a random password."
export async function GetRandomPassword(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const exclude = String(p.ExcludeCharacters ?? '');
    const sets = [
      p.ExcludeLowercase === true ? '' : CHARS.lower,
      p.ExcludeUppercase === true ? '' : CHARS.upper,
      p.ExcludeNumbers === true ? '' : CHARS.numbers,
      p.ExcludePunctuation === true ? '' : CHARS.punctuation,
      p.IncludeSpace === true ? ' ' : '',
    ].map((s) => [...s].filter((c) => !exclude.includes(c)).join('')).filter(Boolean);
    const length = Number(p.PasswordLength ?? 32);
    // source: spec:/shapes/com.amazonaws.secretsmanager#GetRandomPasswordRequest/members/RequireEachIncludedType "If you don't include this switch, the password contains at least one of"
    // PasswordLengthType's Smithy range is 1..4096; a length or alphabet that cannot satisfy the request is an invalid parameter
    // source: spec:/shapes/com.amazonaws.secretsmanager#InvalidParameterException "The parameter name or value is invalid."
    if (!Number.isInteger(length) || length < 1 || length > 4096 || !sets.length || (p.RequireEachIncludedType !== false && length < sets.length)) return invalid(ctx, 'InvalidParameterException', 'The parameter name or value is invalid.');
    // drawn from a secret the World holds (ctx.secret), never computed from the request and a count
    const bytes = Buffer.from(ctx.crypto.digest('sha512', await ctx.secret(`random-password:${await next(ctx, 'password')}`), 'hex'), 'hex');
    const all = sets.join('');
    const chars = Array.from({ length }, (_, i) => all[bytes[i % bytes.length]! % all.length]!);
    // one of each included type, unless the caller does not require it
// source: spec:/shapes/com.amazonaws.secretsmanager#GetRandomPasswordRequest/members/RequireEachIncludedType "If you don't include this switch, the password contains at least one of every character type."
    if (p.RequireEachIncludedType !== false) sets.forEach((s, i) => { chars[i] = s[bytes[(i + 32) % bytes.length]! % s.length]!; });
    return answer(ctx, { RandomPassword: chars.join('') });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#PutResourcePolicy "Attaches a resource-based permission policy to a secret."
export async function PutResourcePolicy(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    if (!parses(p.ResourcePolicy)) return invalid(ctx, 'MalformedPolicyDocumentException', 'This resource policy contains a syntax error.');
    if (!principalsValid(p.ResourcePolicy)) return invalid(ctx, 'MalformedPolicyDocumentException', UNSUPPORTED_PRINCIPAL);
    await save(ctx, row, { _policy: p.ResourcePolicy }, 'secret.put_policy');
    return answer(ctx, { ARN: row.ARN, Name: row.Name });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#GetResourcePolicy "Retrieves the JSON text of the resource-based policy document attached to the secret."
export async function GetResourcePolicy(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = find(ctx, p.SecretId);
    if (!row) return ctx.notFound(S, String(p.SecretId));
    return answer(ctx, { ARN: row.ARN, Name: row.Name, ...(row._policy ? { ResourcePolicy: row._policy } : {}) });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#ValidateResourcePolicy "Validates that a resource policy does not grant a wide range of principals access to your secret."
export async function ValidateResourcePolicy(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    if (p.SecretId !== undefined && !find(ctx, p.SecretId)) return ctx.notFound(S, String(p.SecretId));
    const passed = parses(p.ResourcePolicy);
    if (passed && !principalsValid(p.ResourcePolicy)) return invalid(ctx, 'MalformedPolicyDocumentException', UNSUPPORTED_PRINCIPAL);
    return answer(ctx, { PolicyValidationPassed: passed, ValidationErrors: passed ? [] : [{ CheckName: 'SYNTAX_ERROR', ErrorMessage: 'This resource policy contains a syntax error.' }] });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#ReplicateSecretToRegions "Replicates the secret to a new Regions."
export async function ReplicateSecretToRegions(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    const ReplicationStatus = await replicate(ctx, row, (p.AddReplicaRegions as Array<{ Region: string; KmsKeyId?: string }>) ?? [], p.ForceOverwriteReplicaSecret === true);
    // a failed Region is reported once, then left off the secret's own status
    await save(ctx, row, { ReplicationStatus: ReplicationStatus.filter((s) => s.Status !== 'Failed'), PrimaryRegion: regionOfArn(row.ARN) }, 'secret.replicate');
    return answer(ctx, { ARN: row.ARN, ReplicationStatus });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#RemoveRegionsFromReplication "For a secret that is replicated to other Regions, deletes the secret replicas from the Regions you specify."
export async function RemoveRegionsFromReplication(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const row = writable(ctx, p);
    if (row instanceof Response) return row;
    const gone = (p.RemoveReplicaRegions as string[] | undefined) ?? [];
    for (const region of gone) {
      const replica = find(ctx, row.Name, region);
      if (replica) await ctx.write(S, String(replica.id), { deleted: true }, 'secret.delete_replica');
    }
    const ReplicationStatus = ((row.ReplicationStatus as Row[] | undefined) ?? []).filter((s) => !gone.includes(String(s.Region)));
    await save(ctx, row, { ReplicationStatus }, 'secret.replicate');
    return answer(ctx, { ARN: row.ARN, ReplicationStatus });
  }

// source: spec:/shapes/com.amazonaws.secretsmanager#StopReplicationToReplica "Removes the link between the replica secret and the primary secret and promotes the replica to a primary secret in the replica Region."
export async function StopReplicationToReplica(ctx: HandlerContext): Promise<Response> {
    const p = input(ctx);
    const replica = find(ctx, p.SecretId);
    if (!replica) return ctx.notFound(S, String(p.SecretId));
    const home = String(replica.PrimaryRegion ?? '');
    if (!home || home === regionOfArn(replica.ARN)) return invalid(ctx, 'InvalidRequestException', 'This operation can only be performed on a replica secret. Call it in the Region of the replica you want to promote.');
    // the replica stands alone in its Region, and its primary no longer replicates there
    await ctx.write(S, String(replica.id), { PrimaryRegion: regionOfArn(replica.ARN) }, 'secret.promote');
    const primary = find(ctx, replica.Name, home)!;
    await ctx.write(S, String(primary.id), { ReplicationStatus: ((primary.ReplicationStatus as Row[] | undefined) ?? []).filter((s) => s.Region !== regionOfArn(replica.ARN)) }, 'secret.replicate');
    return answer(ctx, { ARN: replica.ARN });
  }

// A principal that is not an account, an IAM user or role, an STS session or everyone is refused as a malformed policy
// document (docs.aws.amazon.com/secretsmanager/latest/apireference/API_ValidateResourcePolicy.html#API_ValidateResourcePolicy_Errors),
// in the words Secrets Manager answers it with (github.com/boto/boto3/issues/3206).
// source: spec:/shapes/com.amazonaws.secretsmanager#MalformedPolicyDocumentException "The resource policy has syntax errors."
const UNSUPPORTED_PRINCIPAL = 'This resource policy contains an unsupported principal.';

const PRINCIPAL = /^(\*|\d{12}|arn:aws:iam::\d{12}:(root|(user|role)\/[\w+=,.@\/-]+)|arn:aws:sts::\d{12}:assumed-role\/[\w+=,.@\/-]+)$/;

function principalsValid(policy: unknown): boolean {
  const doc = JSON.parse(String(policy)) as { Statement?: Row | Row[] };
  const statements = Array.isArray(doc.Statement) ? doc.Statement : doc.Statement ? [doc.Statement] : [];
  return statements.every((st) => [st.Principal, st.NotPrincipal].every((pr) => {
    if (pr === undefined || pr === '*') return true;
    const aws = (pr as Row).AWS;
    return aws === undefined || (Array.isArray(aws) ? aws : [aws]).every((a) => PRINCIPAL.test(String(a)));
  }));
}

function parses(policy: unknown): boolean {
  try { return typeof JSON.parse(String(policy)) === 'object'; } catch { return false; }
}
