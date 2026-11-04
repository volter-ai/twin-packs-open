// What the Hub's handlers, doors and screens share: accounts and their tokens, model repositories (each a git
// repository of the World), a revision read, the Hub's text errors, and a file's bytes answered with Range.
import { git, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };
export const USER = '_user';
export const TOKEN = '_access_token';
export const REPO = 'ModelInfo';
export const CDN = 'https://us.aws.cdn.hf.co';

export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v);

/** An error as huggingface.co answers a file request: text, with the Hub's `x-error-code` and `x-error-message`. */
export function hubText(status: number, message: string, code?: string): Response {
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
export async function commitOf(ctx: HandlerContext, repo: Row, rev: string): Promise<string | null> {
  const { store, refs } = gitOf(ctx, repo);
  const ref = (rev.startsWith('refs/') ? refs.get(rev) : undefined) ?? refs.get(`refs/heads/${rev}`) ?? refs.get(`refs/tags/${rev}`);
  if (ref) return ref;
  if (/^[0-9a-f]{40}$/.test(rev)) { const o = await store.read(rev); if (o?.type === 'commit') return rev; }
  return null;
}

/** A file's bytes as a download host answers them: whole (200), or from `Range: bytes=<a>-[<b>]` (206, 416 past the
 *  end), the range honoured only when `If-Range` is absent or names this ETag. */
// source: https://www.rfc-editor.org/rfc/rfc9110 "A server MUST ignore a Range header field received with a request method that is unrecognized or for which range handling is not defined."
export function ranged(request: Request, bytes: Uint8Array, etag: string, headers: Record<string, string> = {}): Response {
  const tag = `"${etag}"`;
  const base = { 'accept-ranges': 'bytes', etag: tag, 'content-type': 'application/octet-stream', ...headers };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const ifRange = request.headers.get('if-range');
  if (request.method === 'GET' && range && (!ifRange || ifRange === tag)) {
    const start = Number(range[1]);
    // source: https://www.rfc-editor.org/rfc/rfc9110 "416 (Range Not Satisfiable)"
    if (start >= bytes.length) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${bytes.length}` } });
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (end < start) return new Response(bytes.slice(), { status: 200, headers: { ...base, 'content-length': String(bytes.length) } });
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...base, 'content-length': String(end + 1 - start), 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
  }
  return new Response(request.method === 'HEAD' ? null : bytes.slice(), { status: 200, headers: { ...base, 'content-length': String(bytes.length) } });
}

/** A stored object's download, as `ranged` answers one, read from the blob store without loading it whole: a range is
 *  read alone, and a whole download is streamed in 8 MiB reads, so a downloader's parallel ranges of a model file hold
 *  only the bytes each sends. Null when the store holds no such object. */
export async function objectResponse(ctx: HandlerContext, key: string, etag: string): Promise<Response | null> {
  const request = ctx.call.request;
  const size = await ctx.blobs.size(key);
  if (size === null) return null;
  const tag = `"${etag}"`;
  const base = { 'accept-ranges': 'bytes', etag: tag, 'content-type': 'application/octet-stream' };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const ifRange = request.headers.get('if-range');
  if (request.method === 'GET' && range && (!ifRange || ifRange === tag)) {
    const start = Number(range[1]);
    // source: https://www.rfc-editor.org/rfc/rfc9110 "416 (Range Not Satisfiable)"
    if (start >= size) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (end >= start) return new Response(await ctx.blobs.range(key, start, end) as Uint8Array<ArrayBuffer> | null, { status: 206, headers: { ...base, 'content-length': String(end + 1 - start), 'content-range': `bytes ${start}-${end}/${size}` } });
  }
  const headers = { ...base, 'content-length': String(size) };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const CHUNK = 8 * 1024 * 1024;
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at >= size) { controller.close(); return; }
      const end = Math.min(at + CHUNK, size) - 1;
      const chunk = await ctx.blobs.range(key, at, end);
      if (!chunk) { controller.error(new Error(`${key} is gone`)); return; }
      controller.enqueue(chunk);
      at = end + 1;
    },
  });
  return new Response(body, { status: 200, headers });
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
