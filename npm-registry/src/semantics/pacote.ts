// What an installer reads (pacote, which npm installs through; bun asks the same routes): a package's document, a
// version's tarball, and the provenance a version was published with.
import type { HandlerContext } from '@volter/world-core';
import { attestationKey, blobKey, mayRead, nameOf, notFound, PACKAGE, packument, type Row, wantsAbbreviated } from './shared.ts';

/** `GET /{package}`: the package's document, abbreviated when the request asks for the install form. A restricted
 *  package the caller may not read is not found, as one that does not exist. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "This endpoint responds with the package metadata document, sometimes informally called a \"packument\" or \"doc.json\"."
export async function pacote_packument(ctx: HandlerContext): Promise<Response> {
  const name = nameOf(ctx.call.params.this_spec_escapedName);
  const pkg = ctx.row(PACKAGE, name);
  if (!pkg || !mayRead(ctx, name, pkg)) return notFound();
  const abbreviated = wantsAbbreviated(ctx);
  return Response.json(packument(ctx, pkg, abbreviated), { headers: { 'content-type': abbreviated ? 'application/vnd.npm.install-v1+json' : 'application/json' } });
}

/** `GET /{package}/-/{file}`: a version's tarball, as it was published. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/responses/package-metadata.md "`tarball`: the url of the tarball containing the payload for this package"
export async function pacote_tarballFromResolved(ctx: HandlerContext): Promise<Response> {
  const name = nameOf(ctx.call.params.name);
  const pkg = ctx.row(PACKAGE, name) as Row | undefined;
  if (!pkg || !mayRead(ctx, name, pkg)) return notFound();
  const bytes = await ctx.blobs.get(blobKey(name, nameOf(ctx.call.params.tarball)));
  return bytes ? ctx.raw(new Uint8Array(bytes).buffer, { headers: { 'content-type': 'application/octet-stream' } }) : notFound();
}


/** `GET /-/npm/v1/attestations/{name}@{version}`: a version's provenance, kept when it was published with it (checked
 *  through the World's Sigstore: shared.ts `checkProvenance`); a version published without it is not found. */
// source: https://raw.githubusercontent.com/npm/pacote/v19.0.2/lib/registry.js "const { attestations } = await res.json()"
export async function pacote_manifest(ctx: HandlerContext): Promise<Response> {
  const spec = decodeURIComponent(String(ctx.call.params.spec ?? ''));
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  const pkg = ctx.row(PACKAGE, name);
  if (!pkg || !mayRead(ctx, name, pkg)) return notFound();
  const held = await ctx.blobs.get(attestationKey(name, spec.slice(at + 1)));
  return held ? ctx.raw(new Uint8Array(held).buffer, { headers: { 'content-type': 'application/json' } }) : notFound();
}
