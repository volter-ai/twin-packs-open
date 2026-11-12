// Fulcio's API: a code-signing certificate for a key whose holder proves an OIDC identity, and the certificate chain a
// verifier trusts it by.
import { jwtDecode, jwtVerify, type HandlerContext } from '@volter/world-core';
import { GITHUB_ACTIONS, issue, root, signedBy, status } from './shared.ts';

type Row = Record<string, unknown>;
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : {});

// source: spec:CA_GetTrustBundle "* Returns the bundle of certificates that can be used to validate code signing certificates issued by this Fulcio instance"
export async function CA_GetTrustBundle(ctx: HandlerContext): Promise<Response> {
  return Response.json({ chains: [{ certificates: [(await root(ctx)).certPem] }] });
}

/**
 * The certificate: the identity token is verified by its issuer's keys and audience, the key's holder proves it holds
 * the key by signing the token's subject, and the certificate names the identity (for a GitHub Actions token: the
 * workflow that signs, and its repository, commit and run).
 */
// source: spec:CA_CreateSigningCertificate "* Returns an X.509 certificate created by the Fulcio certificate authority for the given request parameters"
export async function CA_CreateSigningCertificate(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  const token = String((body.credentials as Row | undefined)?.oidcIdentityToken ?? '');
  const request = (body.publicKeyRequest as Row | undefined) ?? {};
  const publicKeyPem = String((request.publicKey as Row | undefined)?.content ?? '');
  const proof = String(request.proofOfPossession ?? '');
  if (!token || !publicKeyPem || !proof) return status(400, 3, 'There was an error processing the identity token');
  let unverified: Row;
  try { unverified = jwtDecode(token).payload; } catch { return status(401, 16, 'There was an error processing the identity token'); }
  // only the issuers Fulcio's configuration trusts; in a World, the World's twin of each
  if (unverified.iss !== GITHUB_ACTIONS.issuer) return status(400, 3, 'There was an error processing the identity token');
  const discovery = await (await ctx.vendorFetch(`${GITHUB_ACTIONS.issuer}/.well-known/openid-configuration`)).json() as Row;
  const keys = await (await ctx.vendorFetch(String(discovery.jwks_uri))).json();
  // its window on the clock the issuer signed it by (receiverNow, the kernel's default)
  const verdict = jwtVerify(token, keys as never) as { valid: boolean; payload?: Row };
  const claims = verdict.valid ? (verdict.payload ?? unverified) : undefined;
  if (!claims) return status(401, 16, 'There was an error processing the identity token');
  const aud = claims.aud;
  if (!(Array.isArray(aud) ? aud.includes(GITHUB_ACTIONS.audience) : aud === GITHUB_ACTIONS.audience)) return status(401, 16, 'There was an error processing the identity token');
  // the proof of possession: the key signed the token's subject (the issuer's challenge claim)
  if (!signedBy(publicKeyPem, String(claims.sub), proof)) return status(400, 3, 'The public key supplied in the request could not be parsed or the signature could not be verified');
  const leaf = await issue(ctx, publicKeyPem, claims, new Date(ctx.occurredAt));
  await ctx.record('_certificate', { issued: ctx.occurredAt, subject: `https://github.com/${String(claims.job_workflow_ref)}`, repository: claims.repository, sha: claims.sha });
  return Response.json({ signedCertificateEmbeddedSct: { chain: { certificates: [leaf, (await root(ctx)).certPem] } } });
}
