// A FILE'S BYTES — raw.githubusercontent.com/{owner}/{repo}/{ref}/{path} (a content host): what the contents API's
// `download_url` names (the ref a branch, a tag, a commit or HEAD), a public repository's to anyone and a private one's to a
// token that reaches it
// (`Authorization: token …`), else 404 as GitHub hides it.
import { git, type HandlerContext } from '@volter/world-core';
import { gitOf, repoNamed, roleIn, who } from '../semantics/shared.ts';

const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const parts = new URL(ctx.call.request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [owner, name, ...rest] = parts;
  const repo = owner && name ? repoNamed(ctx, owner, name) : undefined;
  if (!repo || !roleIn(ctx, repo, who(ctx)) || rest.length < 2) return text(404, '404: Not Found');
  const { store, refs } = gitOf(ctx, repo);
  // the ref may hold slashes (`refs/heads/feature/x`, or a branch named so): the longest ref that names one wins
  let commit: string | undefined;
  let path = '';
  for (let n = rest.length - 1; n >= 1 && !commit; n -= 1) {
    const ref = rest.slice(0, n).join('/');
    // HEAD is the default branch's tip
    commit = (ref === 'HEAD' ? refs.get(refs.head()) : null) ?? refs.get(`refs/heads/${ref}`) ?? refs.get(`refs/tags/${ref}`) ?? (ref.startsWith('refs/') ? refs.get(ref) : null) ?? (/^[0-9a-f]{40}$/.test(ref) ? ref : undefined);
    path = rest.slice(n).join('/');
  }
  let obj = commit ? await store.read(commit) : null;
  if (obj?.type === 'tag') obj = await store.read(git.decodeTag(obj.payload).object);
  if (!obj || obj.type !== 'commit') return text(404, '404: Not Found');
  let tree: string | undefined = git.decodeCommit(obj.payload).tree;
  const segs = path.split('/');
  // Traverse only parent directories; the final component is the file read below.
  for (const seg of segs.slice(0, -1)) {
    const t: Awaited<ReturnType<typeof store.read>> | null = tree ? await store.read(tree) : null;
    if (!t || t.type !== 'tree') return text(404, '404: Not Found');
    const entry: ReturnType<typeof git.decodeTree>[number] | undefined = git.decodeTree(t.payload).find((e) => e.name === seg);
    if (!entry) return text(404, '404: Not Found');
    tree = entry.sha;
  }
  const t = tree ? await store.read(tree) : null;
  const entry = t?.type === 'tree' ? git.decodeTree(t.payload).find((e) => e.name === segs.at(-1)) : undefined;
  const blob = entry ? await store.read(entry.sha) : null;
  if (!blob || blob.type !== 'blob') return text(404, '404: Not Found');
  return new Response(blob.payload as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', etag: `"${entry!.sha}"` } });
}
