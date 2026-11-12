// What Fulcio's operations share: the World's Fulcio root (its own key, made once at random by the World,
// ctx.signingKey, and the self-signed certificate made from it: it certifies nothing outside its World, and no one can
// forge a certificate from the pack), the identity issuers it trusts, and the certificate it issues.
// The root key is Ed25519, so every certificate it signs is a function of the key and the certificate's bytes (a World
// signs deterministically: ECDSA draws a random nonce).
import { digest, publicKeyOf, signWith, verifyWith, type HandlerContext } from '@volter/world-core';

// ── DER ────────────────────────────────────────────────────────────────────────────────────────
// DER, as much of it as a certificate needs (ITU-T X.690, the distinguished encoding; RFC 5280 names what goes in it):
// a type's tag, its length and its content, nested. Fulcio's certificates and their chain are written with it.
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** A length: short form under 128, else the count of big-endian length bytes, then them. */
function length(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>>= 8) bytes.unshift(v & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

const tlv = (tag: number, content: Uint8Array): Uint8Array => cat(Uint8Array.of(tag), length(content.length), content);
const seq = (...items: Uint8Array[]): Uint8Array => tlv(0x30, cat(...items));
const set = (...items: Uint8Array[]): Uint8Array => tlv(0x31, cat(...items));
const octets = (bytes: Uint8Array): Uint8Array => tlv(0x04, bytes);
const bits = (bytes: Uint8Array): Uint8Array => tlv(0x03, cat(Uint8Array.of(0), bytes));
const bool = (v: boolean): Uint8Array => tlv(0x01, Uint8Array.of(v ? 0xff : 0));
const utf8 = (s: string): Uint8Array => tlv(0x0c, new TextEncoder().encode(s));
/** An explicit context tag [n], constructed. */
const explicit = (n: number, content: Uint8Array): Uint8Array => tlv(0xa0 | n, content);
/** An implicit context tag [n], primitive (a GeneralName's uniformResourceIdentifier is [6]). */
const implicit = (n: number, bytes: Uint8Array): Uint8Array => tlv(0x80 | n, bytes);

/** A non-negative INTEGER from its big-endian bytes (a leading zero keeps it positive). */
function integer(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0 && (bytes[i + 1]! & 0x80) === 0) i++;
  const v = bytes.subarray(i);
  return tlv(0x02, (v[0]! & 0x80) ? cat(Uint8Array.of(0), v) : v);
}
const small = (n: number): Uint8Array => integer(Uint8Array.of(n));

/** An OBJECT IDENTIFIER from its dotted form. */
function oid(dotted: string): Uint8Array {
  const [a, b, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
  const out: number[] = [a * 40 + b];
  for (const arc of rest) {
    const chunk: number[] = [arc & 0x7f];
    for (let v = arc >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
}

/** A time as a certificate's validity writes it: UTCTime through 2049, GeneralizedTime after (RFC 5280 4.1.2.5). */
function time(d: Date): Uint8Array {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const y = d.getUTCFullYear();
  return y < 2050 ? tlv(0x17, new TextEncoder().encode(`${p(y % 100)}${body}`)) : tlv(0x18, new TextEncoder().encode(`${p(y, 4)}${body}`));
}

/** One TLV read from the front of `bytes`: its tag, content and total size. */
function read(bytes: Uint8Array, at = 0): { tag: number; content: Uint8Array; end: number } {
  const tag = bytes[at]!;
  let len = bytes[at + 1]!; let head = 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len * 256) + bytes[at + 2 + i]!; head = 2 + n; }
  return { tag, content: bytes.subarray(at + head, at + head + len), end: at + head + len };
}
/** The items of a SEQUENCE's content. */
function items(content: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < content.length;) { const t = read(content, at); out.push(content.subarray(at, t.end)); at = t.end; }
  return out;
}

const pem = (label: string, der: Uint8Array): string => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;

/** The root's name, as Sigstore's own root is named (O=sigstore.dev, CN=sigstore), and its validity: the World's root
 *  holds from 2020 for a century (the twin's decision: a certificate issued at any instant a World's clock names is
 *  inside it). */
const ROOT_NAME = seq(set(seq(oid('2.5.4.10'), utf8('sigstore.dev'))), set(seq(oid('2.5.4.3'), utf8('sigstore'))));
const ROOT_NOT_BEFORE = new Date('2020-01-01T00:00:00Z');
const ROOT_NOT_AFTER = new Date('2120-01-01T00:00:00Z');
// the root's signature algorithm: Ed25519 (RFC 8410, id-Ed25519, no parameters)
const ED25519 = seq(oid('1.3.101.112'));

/** The World's root: its key (Ed25519, ctx.signingKey) and its self-signed CA certificate, a function of the key alone
 *  (Ed25519 signs deterministically), with the subject and authority key identifiers RFC 5280 4.2.1.2 derives from the
 *  key (the SHA-1 of its bits), basic constraints CA:TRUE and key usage certificate and CRL signing, both critical. */
export async function root(ctx: Pick<HandlerContext, 'signingKey'>): Promise<{ keyPem: string; certPem: string }> {
  const key = await ctx.signingKey('fulcio-root', 'Ed25519');
  const made = roots.get(key.publicPem);
  if (made) return made;
  const spki = publicKeyOf(key.publicPem).der;
  const keyBits = read(items(read(spki).content)[1]!).content.subarray(1);
  const ski = new Uint8Array(Buffer.from(digest('sha1', keyBits), 'hex'));
  const extensions = [
    ext('2.5.29.14', false, octets(ski)),
    ext('2.5.29.35', false, seq(implicit(0, ski))),
    ext('2.5.29.19', true, seq(bool(true))),
    ext('2.5.29.15', true, bits(Uint8Array.of(0x06))),
  ];
  const serial = new Uint8Array(Buffer.from(digest('sha256', spki), 'hex').subarray(0, 20));
  serial[0] = (serial[0]! & 0x7f) | 0x01;
  const tbs = seq(explicit(0, small(2)), integer(serial), ED25519, ROOT_NAME, seq(time(ROOT_NOT_BEFORE), time(ROOT_NOT_AFTER)), ROOT_NAME, spki, explicit(3, seq(...extensions)));
  const signature = new Uint8Array(Buffer.from(signWith(key.privatePem, tbs), 'base64'));
  const out = { keyPem: key.privatePem, certPem: pem('CERTIFICATE', seq(tbs, ED25519, bits(signature))) };
  roots.set(key.publicPem, out);
  return out;
}
const roots = new Map<string, { keyPem: string; certPem: string }>(); // cache: the root certificate is a function of its key alone (above), made once per key

/** The GitHub Actions issuer, as Fulcio's identity configuration names it: its URL, and the audience a token must carry. */
// source: https://raw.githubusercontent.com/sigstore/fulcio/feecf71a33f56c26d0aa7156956d46b1d20883ab/config/identity/config.yaml "issuer-url: https://token.actions.githubusercontent.com"
export const GITHUB_ACTIONS = { issuer: 'https://token.actions.githubusercontent.com', audience: 'sigstore' } as const;

/** A gRPC status as the gateway answers it (InvalidArgument 3, Unauthenticated 16). */
// source: spec:/definitions/rpcStatus "code"
export const status = (http: number, code: number, message: string): Response => Response.json({ code, message, details: [] }, { status: http });

const ext = (id: string, critical: boolean, value: Uint8Array): Uint8Array => critical ? seq(oid(id), bool(true), octets(value)) : seq(oid(id), octets(value));

/** The GitHub claims Fulcio writes into a certificate, each by its extension. */
// source: https://raw.githubusercontent.com/sigstore/fulcio/feecf71a33f56c26d0aa7156956d46b1d20883ab/docs/oid-info.md "are formatted as DER-encoded strings; the ASN.1 tag is"
export function githubExtensions(c: Record<string, unknown>): Array<[string, string]> {
  const server = 'https://github.com';
  const s = (k: string): string => String(c[k] ?? '');
  return [
    ['1.3.6.1.4.1.57264.1.8', s('iss')],
    ['1.3.6.1.4.1.57264.1.9', `${server}/${s('job_workflow_ref')}`],
    ['1.3.6.1.4.1.57264.1.10', s('job_workflow_sha')],
    ['1.3.6.1.4.1.57264.1.11', s('runner_environment')],
    ['1.3.6.1.4.1.57264.1.12', `${server}/${s('repository')}`],
    ['1.3.6.1.4.1.57264.1.13', s('sha')],
    ['1.3.6.1.4.1.57264.1.14', s('ref')],
    ['1.3.6.1.4.1.57264.1.15', s('repository_id')],
    ['1.3.6.1.4.1.57264.1.16', `${server}/${s('repository_owner')}`],
    ['1.3.6.1.4.1.57264.1.17', s('repository_owner_id')],
    ['1.3.6.1.4.1.57264.1.18', `${server}/${s('workflow_ref')}`],
    ['1.3.6.1.4.1.57264.1.19', s('workflow_sha')],
    ['1.3.6.1.4.1.57264.1.20', s('event_name')],
    ['1.3.6.1.4.1.57264.1.21', `${server}/${s('repository')}/actions/runs/${s('run_id')}/attempts/${s('run_attempt')}`],
    ['1.3.6.1.4.1.57264.1.22', s('repository_visibility')],
    ['1.3.6.1.4.1.57264.1.24', s('sub')],
  ];
}

/** A certificate's serial: sixteen bytes derived from the key it certifies and when, positive (its top bit clear). Fulcio
 *  draws it at random; a World derives it, so a replay issues the same certificate's serial. */
function serialOf(publicKeyPem: string, notBefore: Date): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(digest('sha256', `${publicKeyPem}\n${notBefore.toISOString()}`), 'hex').subarray(0, 16));
  bytes[0] = (bytes[0]! & 0x7f) | 0x01;
  return bytes;
}

/** Whether a key signed a message (the proof of possession Fulcio asks for). */
export function signedBy(publicKeyPem: string, message: string, signature: string): boolean {
  return verifyWith(publicKeyPem, message, signature);
}

/** A code-signing certificate for a public key and a verified GitHub Actions identity, issued by the World's root. */
export async function issue(ctx: Pick<HandlerContext, 'signingKey'>, publicKeyPem: string, claims: Record<string, unknown>, notBefore: Date): Promise<string> {
  const spki = publicKeyOf(publicKeyPem).der;
  const ed25519 = ED25519;
  // the issuer is the root's subject
  const issuerName = ROOT_NAME;
  const { keyPem } = await root(ctx);
  const notAfter = new Date(notBefore.getTime() + 10 * 60_000);
  const san = `https://github.com/${String(claims.job_workflow_ref)}`;
  const extensions: Uint8Array[] = [
    // key usage: digital signature, critical; extended key usage: code signing
    ext('2.5.29.15', true, bits(Uint8Array.of(0x80))),
    ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.3'))),
    // the identity: the workflow that signed, as a URI subject alternative name, critical (the subject is empty)
    ext('2.5.29.17', true, seq(implicit(6, new TextEncoder().encode(san)))),
    ...githubExtensions(claims).map(([id, v]) => ext(id, false, utf8(v))),
  ];
  const tbs = seq(
    explicit(0, small(2)), integer(serialOf(publicKeyPem, notBefore)), ed25519, issuerName,
    seq(time(notBefore), time(notAfter)), seq(), spki, explicit(3, seq(...extensions)),
  );
  const signature = new Uint8Array(Buffer.from(signWith(keyPem, tbs), 'base64'));
  return pem('CERTIFICATE', seq(tbs, ed25519, bits(signature)));
}

