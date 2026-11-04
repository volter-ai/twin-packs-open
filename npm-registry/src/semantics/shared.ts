// What every family of the npm registry shares: its stored shapes, who is calling, who may write a package, and the
// registry's answers. The registry's documents are npm/registry's docs (raw.githubusercontent.com/npm/registry/main/docs):
// `REGISTRY-API.md`, `responses/package-metadata.md`, `user/authentication.md`, `orgs/memberships.md`.
import { certificateOf, digest, passwordHash, verifyAttestationBundle, verifyWith, type HandlerContext, type WriteHookContext } from '@volter/world-core';

/** The registry's origin. */
export const REGISTRY_ORIGIN = 'https://registry.npmjs.org';

export type Row = Record<string, unknown>;
type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'crypto' | 'call' | 'own' | 'occurredAt'> | Pick<WriteHookContext, 'row' | 'rowsRaw' | 'crypto' | 'call' | 'own' | 'occurredAt'>;

/** The stored types. `_token` is a token by its sha512 (the doc's `key`), never as issued. */
export const PACKAGE = 'package';
export const USER = 'user';
export const ORG = 'org';
export const TOKEN = '_token';

// ── answers ────────────────────────────────────────────────────────────────────────────────────
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "An error. The `message` property is contains a user-facing string. Clients should"

/** The registry's Error object. */
export const fail = (status: number, message: string): Response => Response.json({ error: message }, { status });
/** The registry's not-found. */
export const notFound = (): Response => fail(404, 'Not found');
/** The Legacy Status the registry answers a write with. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "A legacy status. Reports whether or not an operation succeeded."
export const ok = (status = 200): Response => Response.json({ ok: true }, { status });

// ── names ──────────────────────────────────────────────────────────────────────────────────────

/** A package name as a path gives it (`@scope%2fname` or `@scope/name`). */
export const nameOf = (raw: string | undefined): string => decodeURIComponent(raw ?? '');
/** A scoped name's scope (`@volter/x` is `volter`), or none. */
export const scopeOf = (name: string): string | undefined => (name.startsWith('@') && name.includes('/') ? name.slice(1, name.indexOf('/')) : undefined);
/** The file a version's tarball is kept as: the name without its scope, the version, `.tgz`. */
export const tarballFile = (name: string, version: string): string => `${name.includes('/') ? name.slice(name.indexOf('/') + 1) : name}-${version}.tgz`;
/** A version's tarball URL, at the registry's own origin (the manifest's `origin`, rewritten to this twin): a scoped
 *  package's path keeps its slash, as the registry's does. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "usually in the form of `https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`"
export const tarballUrl = (name: string, version: string): string => `${REGISTRY_ORIGIN}/${name}/-/${tarballFile(name, version)}`;
export const blobKey = (name: string, file: string): string => `tarball/${name}/-/${file}`;

// ── who is calling ─────────────────────────────────────────────────────────────────────────────

/** A password as the registry keeps it: its sha512, never as given. */
/** A token's key: "the hexadecimal sha512 hash of the token". */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "which is the hexadecimal sha512 hash of the token."
export const tokenKey = (ctx: Pick<HandlerContext, 'crypto'>, token: string): string => ctx.crypto.digest('sha512', token, 'hex');

export type Caller = { user: Row; readonly: boolean; token?: Row };

/** Who the request's credential names: `Bearer <token>` or `Basic <user:password>`; none is anonymous. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "Authentication can be provided in `Basic` or `Bearer` form."
export function caller(ctx: Reader): Caller | undefined {
  const header = ctx.call.request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  return bearer ? bearerCaller(ctx, bearer) : basicCaller(ctx, header);
}
function bearerCaller(ctx: Reader, bearer: string): Caller | undefined {
    const token = ctx.row(TOKEN, tokenKey(ctx, bearer));
    const user = token ? ctx.row(USER, String(token.user)) : undefined;
    return token && user && (!token.expires || String(token.expires) > ctx.occurredAt) ? { user, readonly: token.readonly === true, token } : undefined;
}


function basicCaller(ctx: Reader, header: string): Caller | undefined {
  const basic = /^Basic\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (basic) {
    let pair = '';
    try { pair = atob(basic); } catch { return undefined; }
    const at = pair.indexOf(':');
    const user = at > 0 ? ctx.row(USER, pair.slice(0, at)) : undefined;
    return user && user._password === passwordHash(String(user.name), pair.slice(at + 1)) ? { user, readonly: false } : undefined;
  }
  return undefined;
}

/** A write's caller, or the registry's refusal: none (401), or a read-only token (403). */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "the token may only be used to authenticate for"
export function writer(ctx: Reader): Caller | Response {
  const who = caller(ctx);
  // Where the documentation stops: the registry's bodies for these two refusals are not recorded; the messages state the
  // rule, as npm's CLI reports it
  if (!who) return fail(401, 'You must be logged in to publish packages.');
  if (who.readonly) return fail(403, 'This token is read-only: it authenticates GET and HEAD requests only.');
  return who;
}

/** An org's roster: user → role. */
export const rosterOf = (org: Row | undefined): Record<string, string> => (org?.roster as Record<string, string> | undefined) ?? {};

/** Whether a user may publish or change a package: a maintainer of one that exists; for a new one, anyone for an
 *  unscoped name, and for a scoped name the user the scope names or a member of the org it names. */
// Where the documentation stops: the registry's docs do not state its permission rule; this is npm's published
// behaviour for scopes (docs.npmjs.com, "About scopes": a scope is a user's or an organization's).
export function mayWrite(ctx: Reader, user: Row, name: string, pkg: Row | undefined): boolean {
  if (pkg) return ((pkg.maintainers as Row[] | undefined) ?? []).some((m) => m.name === user.name) || orgMember(ctx, user, name);
  const scope = scopeOf(name);
  if (!scope) return true;
  return scope === user.name || orgMember(ctx, user, name);
}
function orgMember(ctx: Reader, user: Row, name: string): boolean {
  const scope = scopeOf(name);
  return scope !== undefined && rosterOf(ctx.row(ORG, scope))[String(user.name)] !== undefined;
}

/** Whether a caller may read a package: a public one, anyone; a restricted one, those who may write it. */
export function mayRead(ctx: Reader, name: string, pkg: Row): boolean {
  return pkg._access !== 'restricted' || restrictedRead(ctx, name, pkg);
}
function restrictedRead(ctx: Reader, name: string, pkg: Row): boolean {
  const who = caller(ctx);
  return who !== undefined && mayWrite(ctx, who.user, name, pkg);
}

// ── documents ──────────────────────────────────────────────────────────────────────────────────

/** The versions are stored in npm's own document shape, never as a second projection. */
export const versionsOf = (ctx: Reader, name: string): Row[] => Object.values((ctx.row(PACKAGE, name)?.versions as Record<string, Row> | undefined) ?? {});

/** The abbreviated version object's fields. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/responses/package-metadata.md "Each abbreviated version object contains the following fields:"
const ABBREVIATED = ['name', 'version', 'deprecated', 'dependencies', 'acceptDependencies', 'optionalDependencies', 'devDependencies', 'bundleDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bin', 'directories', 'dist', 'engines', '_hasShrinkwrap', 'hasInstallScript', 'funding', 'cpu', 'os'];

/** A package's public view starts with the kernel's vendor view. Access is World bookkeeping. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/responses/package-metadata.md "To request an _abbreviated_ document with only the fields required to support installation"
export function packument(ctx: Reader, pkg: Row, abbreviated: boolean): Row {
  const own = ctx.own(pkg);
  const { _access, ...view } = own;
  if (!abbreviated) return view;
  const versions = (view.versions as Record<string, Row> | undefined) ?? {};
  return { name: view.name, modified: (view.time as Row | undefined)?.modified, 'dist-tags': view['dist-tags'], versions: Object.fromEntries(Object.entries(versions).map(([v, data]) => [v, Object.fromEntries(ABBREVIATED.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]))])) };
}

/** Whether the request asks for the abbreviated document. */
export const wantsAbbreviated = (ctx: Reader): boolean => (ctx.call.request.headers.get('accept') ?? '').includes('application/vnd.npm.install-v1+json');

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────

/** A token as the registry answers it: the UUID only when it is made. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "token: String,  // \"[REDACTED]\" on subsequent display. The \"Bearer\" token."
export const tokenView = (key: string, t: Row, token?: string): Row => ({
  token: token ?? '[REDACTED]', key, cidr_whitelist: t.cidr_whitelist ?? null, readonly: t.readonly === true, created: t.created, updated: t.updated,
});

/** A new token for a user: a UUID drawn from a secret the World holds for the user, a minted serial and the instant, kept
 *  by its key. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/user/authentication.md "On creation, the `token` attribute will be a valid UUID."
export async function issueToken(ctx: HandlerContext, user: string, readonly: boolean, cidr: string[] | null, expires?: string): Promise<Row> {
  // drawn from a secret the World holds (ctx.secret), so no one computes a token from its user, count and moment
  const label = `npm-token:${user}:${await serial(ctx)}:${ctx.occurredAt}`;
  const token = ctx.crypto.uuidFrom(await ctx.secret(label));
  const key = tokenKey(ctx, token);
  const fields = { user, readonly, cidr_whitelist: cidr, ...(expires ? { expires } : {}), _secret_label: label, created: ctx.occurredAt, updated: ctx.occurredAt };
  await ctx.record(TOKEN, fields, key);
  return tokenView(key, fields, token);
}

export async function readToken(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (typeof row._secret_label !== 'string') return undefined;
  const token = ctx.crypto.uuidFrom(await ctx.secret(row._secret_label));
  return tokenKey(ctx, token) === row.id && bearerCaller(ctx, token)?.token?.id === row.id ? token : undefined;
}

export async function makeUser(ctx: HandlerContext, name: string, email: string, password?: string): Promise<Row | undefined> {
  if (ctx.row(ORG, name)) return undefined;
  const made = await ctx.createUnique(USER, { name, email, ...(password === undefined ? {} : { _password: passwordHash(name, password) }), created: ctx.occurredAt, updated: ctx.occurredAt }, 'user.create', { id: name });
  return made.created ? ctx.row(USER, name)! : undefined;
}

// ── provenance ─────────────────────────────────────────────────────────────────────────────────
// A publish's provenance (`npm publish --provenance`): the Sigstore bundle npm attaches as `<name>-<version>.sigstore`,
// checked as the registry checks it, kept, and served where the version's `dist.attestations` points.

export const attestationKey = (name: string, version: string): string => `attestation/-/npm/v1/attestations/${name}@${version}`;
export const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1';

/** The attachment a publish carries its provenance in. */
// source: https://raw.githubusercontent.com/npm/cli/v10.9.8/workspaces/libnpmpublish/lib/publish.js "const provenanceBundleName = `${manifest.name}-${manifest.version}.sigstore`"
export const provenanceFile = (name: string, version: string): string => `${name}-${version}.sigstore`;

/** Where a version's attestations are served. */
export const attestationsUrl = (name: string, version: string): string => `${REGISTRY_ORIGIN}/-/npm/v1/attestations/${name.replace('/', '%2f')}@${version}`;

/** DSSE's pre-authentication encoding: what an envelope's signature signs. */
// source: https://raw.githubusercontent.com/secure-systems-lab/dsse/master/protocol.md "PAE(type, body) = \"DSSEv1\" + SP + LEN(type) + SP + type + SP + LEN(body) + SP + body"
const pae = (type: string, body: Buffer): Buffer => Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `), body]);

/** The repository a package.json names, as a URL without its `git+` prefix and `.git` suffix. */
const repositoryOf = (manifest: Row): string => {
  const r = manifest.repository;
  const url = typeof r === 'string' ? r : typeof (r as Row | undefined)?.url === 'string' ? String((r as Row).url) : '';
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
};

/**
 * A version's provenance, checked: its statement's subject is this tarball (by name and SHA-512), its certificate is the
 * World's Fulcio's, its signature holds under the certificate's key, and the repository the certificate names is the
 * one the package.json names. The kept attestation, or the registry's refusal.
 */
// source: https://docs.npmjs.com/generating-provenance-statements "Ensure your package.json is configured with a public repository that matches (case-sensitive) where you are publishing with provenance from."
export async function checkProvenance(ctx: HandlerContext, name: string, version: string, tarball: Uint8Array, manifest: Row, serialized: string): Promise<{ predicateType: string; bundle: Row } | Response> {
  const refuse = (why: string): Response => fail(422, `Error verifying sigstore provenance bundle: ${why}`);
  let bundle: Row;
  // the attachment's data is the bundle serialized, as npm attaches it
  // source: https://raw.githubusercontent.com/npm/cli/v10.9.8/workspaces/libnpmpublish/lib/publish.js "data: serializedBundle,"
  try { bundle = JSON.parse(serialized) as Row; } catch { return refuse('the bundle is not JSON'); }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return refuse('the bundle is not an object');
  const envelope = (bundle.dsseEnvelope as Row | undefined) ?? {};
  const payload = Buffer.from(String(envelope.payload ?? ''), 'base64');
  let statement: Row;
  try { statement = JSON.parse(payload.toString('utf8')) as Row; } catch { return refuse('No dsseEnvelope with payload found in sigstore bundle'); }
  if (!statement || typeof statement !== 'object' || Array.isArray(statement)) return refuse('the statement is not an object');
  const subjects = Array.isArray(statement.subject) ? statement.subject as Row[] : [];
  if (subjects.length !== 1 || !subjects[0] || typeof subjects[0] !== 'object') return refuse('Found more than one subject in the sigstore bundle payload');
  const expectedName = `pkg:npm/${name.replace('@', '%40')}@${version}`;
  if (subjects[0]!.name !== expectedName) return refuse('the provenance subject is not this package and version');
  const sha512 = digest('sha512', tarball);
  if (((subjects[0]!.digest as Row | undefined)?.sha512) !== sha512) return refuse(`the provenance subject's digest is not the tarball's (${name}@${version})`);
  const material = (bundle.verificationMaterial as Row | undefined) ?? {};
  const raw = String((((material.x509CertificateChain as Row | undefined)?.certificates as Row[] | undefined)?.[0]?.rawBytes) ?? (material.certificate as Row | undefined)?.rawBytes ?? '');
  const leaf = certificateOf(new Uint8Array(Buffer.from(raw, 'base64')));
  if (!leaf) return refuse('the bundle carries no signing certificate');
  // the certificate is Fulcio's: it verifies under the root Fulcio's trust bundle names (in a World, the World's Fulcio)
  const trust = await (await ctx.vendorFetch('https://fulcio.sigstore.dev/api/v2/trustBundle')).json() as { chains?: Array<{ certificates?: string[] }> };
  if (!(trust.chains ?? []).flatMap((c) => c.certificates ?? []).some((root) => leaf.issuedBy(root))) return refuse('the signing certificate is not issued by Fulcio');
  const roots = (trust.chains ?? []).flatMap((c) => c.certificates ?? []);
  // source: https://raw.githubusercontent.com/npm/cli/v10.9.8/workspaces/libnpmpublish/lib/provenance.js "await sigstore.verify(provenanceBundle)"
  const logKey = await (await ctx.vendorFetch('https://rekor.sigstore.dev/api/v1/log/publicKey')).text();
  try { await verifyAttestationBundle(bundle, { certificates: roots, logKeys: [logKey] }); } catch (error) { return refuse(String(error)); }
  const signature = String(((envelope.signatures as Row[] | undefined)?.[0])?.sig ?? '');
  if (!verifyWith(leaf.publicKey.pem, pae(String(envelope.payloadType ?? ''), payload), signature)) return refuse('the envelope\'s signature does not verify under the signing certificate');
  // the repository: the certificate's workflow URI (https://github.com/<owner>/<repo>/.github/workflows/…) names it
  const san = /URI:(https:\/\/github\.com\/[^/]+\/[^/]+)\//.exec(leaf.subjectAltName ?? '')?.[1] ?? '';
  const declared = repositoryOf(manifest);
  if (declared !== san) return refuse(`Failed to validate repository information: package.json: "repository.url" is "${declared}", expected to match "${san}" from provenance`);
  return { predicateType: String(statement.predicateType ?? SLSA_PROVENANCE), bundle };
}

/** The World's next number (a nonce in a secret's label, a numeric id), issued from the tree over `_serial` (ctx.issue),
 *  never a row count. */
const serial = async (ctx: Pick<HandlerContext, 'issue'>): Promise<number> => Number(await ctx.issue('_serial'));
