// What Rekor's operations share: the World's log key (its own, made once at random by the World, ctx.signingKey: it
// signs nothing outside its World, and no one can forge an entry from the pack),
// the log's identity, the canonical form an entry is kept in, and the Merkle tree (RFC 6962) its proofs come from.
// The log key is Ed25519, so every checkpoint and entry it signs is a function of the key and the bytes (a World signs
// deterministically: ECDSA draws a random nonce).
import { digest, publicKeyOf, signWith, type HandlerContext } from '@volter/world-core';

const sha256 = (b: Uint8Array | string): Buffer => Buffer.from(digest('sha256', b), 'hex');
/** The log's key (Ed25519, the World's) and what is made of it: its public key, the log's id (the SHA-256 of the
 *  DER-encoded public key) and a checkpoint's key hint (its first four bytes). */
export type LogKey = { privatePem: string; publicPem: string; id: string; hint: Buffer };
// source: spec:/definitions/LogEntry "This is the SHA256 hash of the DER-encoded public key for the log at the time the entry was included in the log"
export async function logKey(ctx: Pick<HandlerContext, 'signingKey'>): Promise<LogKey> {
  const key = await ctx.signingKey('rekor-log', 'Ed25519');
  const spki = publicKeyOf(key.publicPem).der;
  return { ...key, id: sha256(spki).toString('hex'), hint: sha256(spki).subarray(0, 4) };
}
/** The log's origin as its checkpoints name it, and its tree. */
export const ORIGIN = 'rekor.sigstore.dev';
export const TREE_ID = '1193050959916656506';
const TREE_HEX = BigInt(TREE_ID).toString(16).padStart(16, '0');
export const ENTRY = '_entry';

export type Row = Record<string, unknown>;
// source: spec:/definitions/Error "message"
export const fail = (status: number, message: string): Response => Response.json({ code: status, message }, { status });

/** JSON with its keys sorted at every level, as the log signs and hashes it. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as Row).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Row)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * The entry as the log keeps it. An in-toto envelope is kept without its payload, by the payload's and the envelope's
 * hashes; a DSSE entry by its envelope's and payload's hashes and its signatures with their verifiers; a hashed
 * signature as proposed. Where the documentation stops: Rekor's canonical forms are in its types' code, not its API
 * description, which names only the proposed shapes; these follow those shapes' fields.
 */
// source: spec:createLogEntry "Creates an entry in the transparency log"
export function canonicalize(proposed: Row): Row | undefined {
  const kind = String(proposed.kind ?? ''); const spec = (proposed.spec as Row | undefined) ?? {};
  const b64 = (s: unknown): Buffer => Buffer.from(String(s ?? ''), 'base64');
  if (kind === 'intoto') {
    const content = (spec.content as Row | undefined) ?? {}; const env = (content.envelope as Row | undefined) ?? {};
    const payload = b64(env.payload);
    return { apiVersion: String(proposed.apiVersion ?? '0.0.2'), kind, spec: { content: {
      envelope: { payloadType: env.payloadType, signatures: ((env.signatures as Row[] | undefined) ?? []).map((s) => ({ sig: s.sig, publicKey: s.publicKey })) },
      hash: { algorithm: 'sha256', value: sha256(canonical(env)).toString('hex') },
      payloadHash: { algorithm: 'sha256', value: sha256(payload).toString('hex') },
    } } };
  }
  if (kind === 'dsse') {
    const env = JSON.parse(String((spec.proposedContent as Row | undefined)?.envelope ?? '{}')) as Row;
    const verifiers = ((spec.proposedContent as Row | undefined)?.verifiers as string[] | undefined) ?? [];
    return { apiVersion: String(proposed.apiVersion ?? '0.0.1'), kind, spec: {
      envelopeHash: { algorithm: 'sha256', value: sha256(canonical(env)).toString('hex') },
      payloadHash: { algorithm: 'sha256', value: sha256(b64(env.payload)).toString('hex') },
      signatures: ((env.signatures as Row[] | undefined) ?? []).map((s, i) => ({ signature: s.sig, verifier: verifiers[i] ?? verifiers[0] })),
    } };
  }
  if (kind === 'hashedrekord') return { apiVersion: String(proposed.apiVersion ?? '0.0.1'), kind, spec };
  return undefined;
}

// ── RFC 6962: leaves, the tree head and audit paths ──────────────────────────────────────────
// source: https://www.rfc-editor.org/rfc/rfc6962 "MTH({d(0)}) = SHA-256(0x00 || d(0))."
export const leafHash = (body: Uint8Array): Buffer => sha256(Buffer.concat([Buffer.of(0), body]));
const node = (l: Buffer, r: Buffer): Buffer => sha256(Buffer.concat([Buffer.of(1), l, r]));
const split = (n: number): number => { let k = 1; while (k * 2 < n) k *= 2; return k; };
export function rootOf(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return sha256(new Uint8Array());
  if (leaves.length === 1) return leaves[0]!;
  const k = split(leaves.length);
  return node(rootOf(leaves.slice(0, k)), rootOf(leaves.slice(k)));
}
/** The audit path for leaf m of the tree (RFC 6962 2.1.1). */
export function path(m: number, leaves: Buffer[]): Buffer[] {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k ? [...path(m, leaves.slice(0, k)), rootOf(leaves.slice(k))] : [...path(m - k, leaves.slice(k)), rootOf(leaves.slice(0, k))];
}

/** A signature by the log's key, base64. */
export const signed = (key: LogKey, data: string | Uint8Array): string => signWith(key.privatePem, data);

/** The signed checkpoint for a tree (a signed note: origin, size, root, then the signature line). Where the
 *  documentation stops: the key hint is the first four bytes of the key's SHA-256, as the log's note verifiers take it. */
export function checkpoint(key: LogKey, size: number, root: Buffer): string {
  const text = `${ORIGIN} - ${TREE_ID}\n${size}\n${root.toString('base64')}\n`;
  const sig = Buffer.concat([key.hint, Buffer.from(signed(key, text), 'base64')]).toString('base64');
  return `${text}\n— ${ORIGIN} ${sig}\n`;
}

/** Every entry, in log order. */
export const entries = (ctx: Pick<HandlerContext, 'rowsRaw'>): Row[] => (ctx.rowsRaw(ENTRY) as Row[]).filter((r) => r.deleted !== true).sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
export const uuidOf = (leaf: Buffer): string => `${TREE_HEX}${leaf.toString('hex')}`;

/** An entry as the log answers it, by its UUID: its body, when and where it was logged, the timestamp it signed, and
 *  its inclusion proof in the tree as it stands. */
// source: spec:/definitions/LogEntry "Signature over the logID, logIndex, body and integratedTime."
export function logEntry(key: LogKey, e: Row, all: Row[]): Row {
  const leaves = all.map((x) => Buffer.from(String(x.leaf), 'hex'));
  const index = Number(e.logIndex);
  const root = rootOf(leaves);
  return { [String(e.id)]: {
    body: e.body, integratedTime: e.integratedTime, logID: key.id, logIndex: index,
    verification: {
      signedEntryTimestamp: e.set,
      inclusionProof: { logIndex: index, rootHash: root.toString('hex'), treeSize: leaves.length, hashes: path(index, leaves).map((h) => h.toString('hex')), checkpoint: checkpoint(key, leaves.length, root) },
    },
  } };
}
