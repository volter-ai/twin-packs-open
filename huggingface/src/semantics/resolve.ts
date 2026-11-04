// A file at a revision: resolve redirects it to where its bytes are (a regular file to the resolve cache, an LFS
// pointer's object to the CDN) with the Hub's linked headers.
import { git, type HandlerContext } from '@volter/world-core';
import { downloadHref, fileAt, repoNamed } from './shared.ts';

// source: spec:get_namespace_repo_resolve_rev_path "This endpoint requires to follow redirection"
export async function get_namespace_repo_resolve_rev_path(ctx: HandlerContext): Promise<Response> {
  const f = await fileAt(ctx);
  if (f instanceof Response) return f;
  const lfs = git.parseLfsPointer(f.blob.bytes);
  if (lfs) {
    // Where the documentation stops: the Hub redirects an LFS file to its CDN (a signed URL, read 2026-09-30); the
    // twin's CDN names the object by its oid
    const location = await downloadHref(ctx, repoNamed(ctx, f.namespace, f.repo)!, lfs.oid);
    return new Response(`Found. Redirecting to ${location}`, { status: 302, headers: {
      'content-type': 'text/plain; charset=utf-8', location,
      'x-repo-commit': f.commit, 'x-linked-size': String(lfs.size), 'x-linked-etag': `"${lfs.oid}"`, 'accept-ranges': 'bytes',
    } });
  }
  const at = `/api/resolve-cache/models/${f.namespace}/${f.repo}/${f.commit}/${f.path}?${encodeURIComponent(`/${f.namespace}/${f.repo}/resolve/${f.rev}/${f.path}`)}=&etag=${encodeURIComponent(`"${f.blob.sha}"`)}`;
  return new Response(`Temporary Redirect. Redirecting to ${at}`, { status: 307, headers: {
    'content-type': 'text/plain; charset=utf-8', location: at, 'x-repo-commit': f.commit, 'x-linked-etag': `"${f.blob.sha}"`,
  } });
}
