// What the Hub's handlers, doors and screens share: accounts and their tokens, model repositories (each a git
// repository of the World), a revision read, the Hub's text errors, and a file's bytes answered with Range.
import { bytesResponse, git, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const USER = '_user';
export const TOKEN = '_access_token';
export const REPO = 'ModelInfo';
export const CDN = 'https://us.aws.cdn.hf.co';

export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v);

/** An error as huggingface.co answers a file request: text, with the Hub's `x-error-code` and `x-error-message`. */
function hubText(status: number, message: string, code?: string): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-error-message': message, ...(code ? { 'x-error-code': code } : {}) } });
}

/** The account a request's token opens: `Authorization: Bearer hf_…`, or git's Basic with the token as the password. */
export function userOf(ctx: HandlerContext): Row | undefined {
  const auth = ctx.call.request.headers.get('authorization') ?? '';
  let token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const basic = /^Basic\s+(\S+)$/i.exec(auth)?.[1];
  if (!token && basic) { try { token = atob(basic).split(':').slice(1).join(':'); } catch { token = undefined; } }
  if (!token) return undefined;
  const hash = sha256(ctx, token);
  const grant = ctx.rowsRaw(TOKEN).find((row) => row.sha256 === hash && row.revoked !== true);
  return grant ? ctx.row(USER, String(grant.user)) : ctx.rowsRaw(USER).find((u) => u.deleted !== true && u.token_sha256 === hash);
}

/** A model repository by its namespace and name (a git client may name it with `.git`). */
export function repoNamed(ctx: HandlerContext, namespace: string, name: string): Row | undefined {
  const full = `${namespace}/${name.replace(/\.git$/, '')}`;
  return ctx.rowsRaw(REPO).find((r) => r.deleted !== true && r.name === full);
}

/** A repository's git data in the World. */
export const gitOf = (ctx: HandlerContext, repo: Row): { store: InstanceType<typeof git.GitObjectStore>; refs: InstanceType<typeof git.GitRefs> } => ctx.git(`r${String(repo.id)}`);

/** The commit a revision names: a branch, a tag, or a full commit sha the repository holds. */
async function commitOf(ctx: HandlerContext, repo: Row, rev: string): Promise<string | null> {
  const { store, refs } = gitOf(ctx, repo);
  const ref = (rev.startsWith('refs/') ? refs.get(rev) : undefined) ?? refs.get(`refs/heads/${rev}`) ?? refs.get(`refs/tags/${rev}`);
  if (ref) return ref;
  if (/^[0-9a-f]{40}$/.test(rev)) { const o = await store.read(rev); if (o?.type === 'commit') return rev; }
  return null;
}

/** A file's bytes as a download host answers them: whole (200), or from `Range: bytes=` (206, 416 past the
 *  end), the range honoured only when `If-Range` is absent or names this ETag. */
// source: https://www.rfc-editor.org/rfc/rfc9110 "A server MUST ignore a Range header field received with a request method that is unrecognized or for which range handling is not defined."
export function ranged(request: Request, bytes: Parameters<typeof bytesResponse>[1], etag: string, headers: Record<string, string>): Response {
  const tag = `"${etag}"`;
  const ifRange = request.headers.get('if-range');
  if (request.method !== 'GET' || (ifRange && ifRange !== tag)) {
    const downloadHeaders = new Headers(request.headers);
    downloadHeaders.delete('range');
    request = new Request(request.url, { method: request.method, headers: downloadHeaders });
  }
  const answer = bytesResponse(request, bytes, 'application/octet-stream');
  answer.headers.delete('cache-control');
  answer.headers.set('etag', tag);
  for (const [name, value] of Object.entries(headers)) answer.headers.set(name, value);
  return answer;
}

/** A stored object's download through the kernel's bounded byte reader, without loading it whole.
 *  Null when the store holds no such object. */
export async function objectResponse(ctx: HandlerContext, key: string, etag: string): Promise<Response | null> {
  const size = await ctx.blobs.size(key);
  if (size === null) return null;
  return ranged(ctx.call.request, { size, range: (start, end) => ctx.blobs.range(key, start, end) }, etag, {});
}

/** The file a resolve names at its revision (its commit, the blob at its path), or the Hub's refusal. */
export async function fileAt(ctx: HandlerContext): Promise<{ commit: string; namespace: string; repo: string; path: string; rev: string; blob: { sha: string; bytes: Uint8Array } } | Response> {
  const p = ctx.call.params;
  const namespace = String(p.namespace); const repo = String(p.repo); const rev = String(p.rev); const path = String(p.path);
  const r = repoNamed(ctx, namespace, repo);
  // Where the documentation stops: huggingface.co answers an anonymous request for a repository it does not have as it
  // answers one it may not read (read 2026-09-30)
  if (!r) return hubText(401, 'Invalid username or password.');
  if (r._private && userOf(ctx)?.id !== r._owner) return hubText(401, 'Invalid username or password.');
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/file_download "RevisionNotFoundError"
  const commit = await commitOf(ctx, r, rev);
  if (!commit) return hubText(404, `Invalid rev id: ${rev}`, 'RevisionNotFound');
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/file_download "EntryNotFoundError"
  const blob = await git.blobAt(gitOf(ctx, r).store, commit, path);
  if (!blob) return hubText(404, 'Entry not found', 'EntryNotFound');
  return { commit, namespace, repo, path, rev, blob };
}

/** A private object's download link is a capability issued only after the owner's authenticated read. */
// source: https://huggingface.co/docs/huggingface_hub/package_reference/file_download "its git-sha1 if stored in git, or its sha256 if stored in git-lfs."
export const downloadHref = async (ctx: HandlerContext, repo: Row, oid: string): Promise<string> => `${CDN}/repos/${repo.name}/${oid}${repo._private ? `?token=${await ctx.secret(`huggingface-lfs-download:${repo.id}:${oid}`)}` : ''}`;
