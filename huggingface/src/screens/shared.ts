// Git and git-lfs over HTTP at a model repository's own path, and the CDN its LFS objects go up to and come down from:
// the kernel's git library (smart HTTP, `git/lfs.ts`) over the repository's git data (ctx.git) and the pack's resource
// blobs (LFS objects, by oid). Reading a public repository is anyone's; private reads, pushes and uploads need the
// owner's token, which git and git-lfs send as a Basic password.
import { git, type HandlerContext } from '@volter/world-core';
import { CDN, downloadHref, gitOf, objectResponse, repoNamed, type Row, userOf } from '../semantics/shared.ts';

// Where the documentation stops: huggingface.co's challenge to git without a credential (read as git reports it)
const challenge = (): Response => new Response('Invalid username or password.\n', { status: 401, headers: { 'www-authenticate': 'Basic realm="Authentication required", charset="UTF-8"', 'content-type': 'text/plain' } });
const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

/** The pack's LFS objects, by oid. */
const objects = (ctx: HandlerContext, repo: Row): git.LfsStore => ({
  size: (oid) => ctx.blobs.size(`lfs/${repo.id}/${oid}`), put: (oid, bytes) => ctx.blobs.put(`lfs/${repo.id}/${oid}`, bytes),
  putStream: (oid, chunks, accept) => ctx.blobs.putStream(`lfs/${repo.id}/${oid}`, chunks, accept),
});

/** The repository a path names, and whether the caller may write it (its owner). */
function target(ctx: HandlerContext): { repo: Row; owner: boolean; caller: Row | undefined } | Response {
  const repo = repoNamed(ctx, String(ctx.call.params.namespace), String(ctx.call.params.repo));
  if (!repo) return text(404, 'Repository not found\n');
  const caller = userOf(ctx);
  return { repo, owner: Boolean(caller && caller.id === repo._owner), caller };
}

/** A git smart-HTTP request (the advertisement, a fetch, a push); a push is the owner's. */
export async function smartHttp(ctx: HandlerContext, tail: 'info/refs' | 'git-upload-pack' | 'git-receive-pack'): Promise<Response> {
  const t = target(ctx);
  if (t instanceof Response) return t;
  if (t.repo._private && !t.owner) return challenge();
  const pushing = tail === 'git-receive-pack' || new URL(ctx.call.request.url).searchParams.get('service') === 'git-receive-pack';
  if (pushing && !t.caller) return challenge();
  if (pushing && !t.owner) return text(403, `You are not authorized to push to this repo.\n`);
  const { store, refs } = gitOf(ctx, t.repo);
  return (await git.serveSmartHttp(ctx.call.request, { store, refs }, tail)) ?? text(404, 'Not Found\n');
}

/** git-lfs's batch API: an upload is the owner's; a download anyone's. The objects go up to, and come down from, the
 *  CDN; an upload's href carries a token drawn from the World's secret for that object. */
export async function lfsBatch(ctx: HandlerContext): Promise<Response> {
  const t = target(ctx);
  if (t instanceof Response) return t;
  let body: unknown;
  try { body = await ctx.call.request.clone().json(); } catch { return Response.json({ message: 'the request is not JSON' }, { status: 422, headers: { 'content-type': git.LFS_TYPE } }); }
  if (t.repo._private && !t.owner) return challenge();
  const upload = (body as { operation?: unknown })?.operation === 'upload';
  // source: https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md "The user has read, but not write access."
  if (upload && !t.caller) return challenge();
  if (upload && !t.owner) return Response.json({ message: 'You are not authorized to push to this repo.' }, { status: 403, headers: { 'content-type': git.LFS_TYPE } });
  const name = String(t.repo.name);
  const hrefs = new Map<string, string>();
  const candidates = (body as { objects?: unknown })?.objects;
  for (const o of (Array.isArray(candidates) ? candidates : []) as Array<{ oid?: unknown; size?: unknown }>) {
    const oid = String(o?.oid ?? '');
    const size = Number(o?.size);
    if (!upload) hrefs.set(oid, await downloadHref(ctx, t.repo, oid));
    if (upload) hrefs.set(oid, `${CDN}/upload/${name}/${oid}?token=${await uploadToken(ctx, name, oid, size)}&size=${size}`);
  }
  return git.lfsBatch(body, { store: objects(ctx, t.repo), href: (_operation, o) => hrefs.get(o.oid)! });
}

/** The token an upload's href carries for one object of one repository. */
const uploadToken = async (ctx: HandlerContext, repo: string, oid: string, size: number): Promise<string> => (await ctx.secret(`huggingface-lfs-upload:${repo}:${oid}:${size}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

/** The CDN: an LFS object's bytes (`GET /repos/{namespace}/{repo}/{oid}`), with Range and If-Range. */
export async function cdnDownload(ctx: HandlerContext): Promise<Response> {
  const m = /^\/repos\/([^/]+)\/([^/]+)\/([0-9a-f]{64})$/.exec(new URL(ctx.call.request.url).pathname);
  const repo = m ? repoNamed(ctx, m[1]!, m[2]!) : undefined;
  if (m && repo?._private && userOf(ctx)?.id !== repo._owner && new URL(ctx.call.request.url).searchParams.get('token') !== await ctx.secret(`huggingface-lfs-download:${repo.id}:${m[3]}`)) return challenge();
  const answer = m && repo ? await objectResponse(ctx, `lfs/${repo.id}/${m[3]}`, m[3]!) : null;
  return answer ?? text(404, 'Not Found\n');
}

/** The CDN's upload (`PUT /upload/{namespace}/{repo}/{oid}?token=…`, the batch API's href): kept when the token is the
 *  one its href carried and the bytes hash to the oid at the size git-lfs declared. */
export async function cdnUpload(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const m = /^\/upload\/([^/]+)\/([^/]+)\/([0-9a-f]{64})$/.exec(url.pathname);
  if (!m || ctx.call.request.method !== 'PUT') return text(404, 'Not Found\n');
  const name = `${m[1]}/${m[2]}`;
  if (!repoNamed(ctx, m[1]!, m[2]!) || url.searchParams.get('token') !== (await uploadToken(ctx, name, m[3]!, Number(url.searchParams.get('size'))))) return text(403, 'Forbidden\n');
  const repo = repoNamed(ctx, m[1]!, m[2]!)!;
  // the body streams to the store as it arrives: a model's weights are never held whole
  return git.lfsUpload(ctx.call.request.body, { oid: m[3]!, size: Number(url.searchParams.get('size')) }, objects(ctx, repo));
}
