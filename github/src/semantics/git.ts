// GitHub's Git database operations (https://docs.github.com/en/rest/git): a ref made at a commit (what a push sets
// off follows), refs, annotated tags, trees and blobs read from the repository's git plane.
import { git, type HandlerContext } from '@volter/world-core';
import { actorLogin, bodyOf, fail, gitOf, invalid, json, pushed, repoOfPath, str, who } from './shared.ts';

/** git/create-ref: `refs/heads/…` or `refs/tags/…` at a commit or tag object (201); taken already, 422 (where the
 *  documentation stops, the refusals' words are GitHub's). */
// source: https://docs.github.com/en/rest/git/refs "The name of the fully qualified reference (ie: refs/heads/master ). If it doesn't start with 'refs' and have at least two slashes, it will be rejected."
// source: https://docs.github.com/en/rest/git/refs "The SHA1 value for this reference."
export async function git_create_ref(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const ref = str(b.ref);
  const sha = str(b.sha);
  if (!ref || !/^refs\/[^/]+\/.+/.test(ref) || ref.split('/').length < 3) return fail(ctx, 422, 'Reference name must start with \'refs/\' and have at least two slashes.');
  if (!sha) return invalid('Reference', 'sha', 'missing_field');
  const { store, refs } = gitOf(ctx, repo);
  const o = await store.read(sha);
  if (!o || (o.type !== 'commit' && o.type !== 'tag')) return fail(ctx, 422, 'Object does not exist');
  if (refs.get(ref)) return fail(ctx, 422, 'Reference already exists');
  refs.set(ref, sha);
  await pushed(ctx, repo, [{ name: ref, old: git.ZERO_SHA, new: sha }], actorLogin(who(ctx)!));
  const full = String(repo.full_name);
  return json({ ref, node_id: btoa(`04:Ref${full}:${ref}`), url: `https://api.github.com/repos/${full}/git/${ref}`, object: { sha, type: o.type, url: `https://api.github.com/repos/${full}/git/${o.type === 'tag' ? 'tags' : 'commits'}/${sha}` } }, 201);
}

/** git/get-tree: a tree (or a commit's), its entries; every level under it with `recursive`, whatever its value. */
// source: https://docs.github.com/en/rest/git/trees "Returns a single tree using the SHA1 value or ref name for that tree."
// source: https://docs.github.com/en/rest/git/trees "Setting this parameter to any value returns the objects or subtrees referenced by the tree specified in :tree_sha . For example, setting recursive to any of the following will enable returning objects or subtrees: 0 , 1 , "true" , and "false" ."
export async function git_get_tree(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const { store, refs } = gitOf(ctx, repo);
  const given = String(ctx.call.params.tree_sha ?? '');
  let sha = refs.get(`refs/heads/${given}`) ?? refs.get(`refs/tags/${given}`) ?? given;
  let o = await store.read(sha);
  if (o?.type === 'commit') { sha = git.decodeCommit(o.payload).tree; o = await store.read(sha); }
  if (!o || o.type !== 'tree') return fail(ctx, 404, 'Not Found');
  const full = String(repo.full_name);
  const recursive = ctx.params.recursive !== undefined;
  const tree: Array<Record<string, unknown>> = [];
  const walk = async (payload: Uint8Array, prefix: string): Promise<void> => {
    for (const e of git.decodeTree(payload)) {
      const path = `${prefix}${e.name}`;
      const dir = e.mode === '40000' || e.mode === '040000';
      const kind = dir ? 'tree' : e.mode === '160000' ? 'commit' : 'blob';
      const child = kind === 'commit' ? null : await store.read(e.sha);
      tree.push({ path, mode: dir ? '040000' : e.mode, type: kind, sha: e.sha, ...(kind === 'blob' ? { size: child?.payload.length ?? 0 } : {}), url: `https://api.github.com/repos/${full}/git/${kind === 'tree' ? 'trees' : 'blobs'}/${e.sha}` });
      if (dir && recursive && child) await walk(child.payload, `${path}/`);
    }
  };
  await walk(o.payload, '');
  return json({ sha, url: `https://api.github.com/repos/${full}/git/trees/${sha}`, tree, truncated: false });
}

/** git/get-blob: a blob's bytes, base64. */
// source: https://docs.github.com/en/rest/git/blobs "The content in the response will always be Base64 encoded."
export async function git_get_blob(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const sha = String(ctx.call.params.file_sha ?? '');
  const o = await gitOf(ctx, repo).store.read(sha);
  if (!o || o.type !== 'blob') return fail(ctx, 404, 'Not Found');
  let bin = '';
  for (const x of o.payload) bin += String.fromCharCode(x);
  return json({ sha, node_id: btoa(`04:Blob${sha}`), size: o.payload.length, url: `https://api.github.com/repos/${String(repo.full_name)}/git/blobs/${sha}`, content: btoa(bin).replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
}

/** A ref as GitHub answers it: its name, and the object it points at (a commit, or an annotated tag). */
async function refAnswer(ctx: HandlerContext, repo: Record<string, unknown>, name: string, sha: string): Promise<Record<string, unknown>> {
  const full = String(repo.full_name);
  const o = await gitOf(ctx, repo).store.read(sha);
  const type = o?.type === 'tag' ? 'tag' : 'commit';
  return { ref: name, node_id: btoa(`04:Ref${full}:${name}`), url: `https://api.github.com/repos/${full}/git/${name}`, object: { sha, type, url: `https://api.github.com/repos/${full}/git/${type === 'tag' ? 'tags' : 'commits'}/${sha}` } };
}

/** git/get-ref: one ref, named as `heads/<branch>` or `tags/<tag>`; none so named, 404. */
// source: https://docs.github.com/en/rest/git/refs "Returns a single reference from your Git database. The :ref in the URL must be formatted as heads/<branch name> for branches and tags/<tag name> for tags. If the :ref doesn't match an existing ref, a 404 is returned."
export async function git_get_ref(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const name = `refs/${String(ctx.call.params.ref ?? '').replace(/^refs\//, '')}`;
  const sha = gitOf(ctx, repo).refs.get(name);
  return sha ? json(await refAnswer(ctx, repo, name, sha)) : fail(ctx, 404, 'Not Found');
}

/** git/list-matching-refs: the refs whose names start with the one given, an empty array when none does. */
// source: https://docs.github.com/en/rest/git/refs "If the :ref doesn't exist in the repository, but existing refs start with :ref , they will be returned as an array."
export async function git_list_matching_refs(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const prefix = `refs/${String(ctx.call.params.ref ?? '').replace(/^refs\//, '')}`;
  const found = gitOf(ctx, repo).refs.list().filter((r) => r.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name));
  const out: Array<Record<string, unknown>> = [];
  for (const r of found) out.push(await refAnswer(ctx, repo, r.name, r.sha));
  return json(out);
}

/** git/get-tag: an annotated tag object — its name, message, tagger and the object it tags (an unsigned tag's
 *  verification "unsigned"); a sha that is no tag object, 404. */
// source: https://docs.github.com/en/rest/git/tags "The response will include a verification object that describes the result of verifying the commit's signature."
export async function git_get_tag(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const sha = String(ctx.call.params.tag_sha ?? '');
  const o = await gitOf(ctx, repo).store.read(sha);
  if (!o || o.type !== 'tag') return fail(ctx, 404, 'Not Found');
  const t = git.decodeTag(o.payload);
  const full = String(repo.full_name);
  return json({
    node_id: btoa(`03:Tag${sha}`), tag: t.tag, sha, url: `https://api.github.com/repos/${full}/git/tags/${sha}`, message: t.message,
    tagger: t.tagger ? { name: t.tagger.name, email: t.tagger.email, date: new Date(t.tagger.time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') } : null,
    object: { type: t.type, sha: t.object, url: `https://api.github.com/repos/${full}/git/${t.type === 'tag' ? 'tags' : t.type === 'tree' ? 'trees' : t.type === 'blob' ? 'blobs' : 'commits'}/${t.object}` },
    verification: { verified: false, reason: 'unsigned', signature: null, payload: null, verified_at: null },
  });
}

/** git/create-tag: an annotated tag object (its name, message, the object it tags and its tagger, the caller unless
 *  named), by someone who can write (201); it names no ref until one is made at it. An object the repository does not
 *  hold, 422. */
// source: https://docs.github.com/en/rest/git/tags "Note that creating a tag object does not create the reference that makes a tag in Git."
// source: https://docs.github.com/en/rest/git/tags "Can be one of : commit , tree , blob"
export async function git_create_tag(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const tag = str(b.tag);
  const message = typeof b.message === 'string' ? b.message : undefined;
  const object = str(b.object);
  const type = str(b.type);
  if (!tag) return invalid('Tag', 'tag', 'missing_field');
  if (message === undefined) return invalid('Tag', 'message', 'missing_field');
  if (!object) return invalid('Tag', 'object', 'missing_field');
  if (!type || !['commit', 'tree', 'blob'].includes(type)) return invalid('Tag', 'type', type ? 'invalid' : 'missing_field');
  const { store } = gitOf(ctx, repo);
  const o = await store.read(object);
  if (!o || o.type !== type) return fail(ctx, 422, 'Object does not exist');
  const given = (b.tagger as Record<string, unknown> | undefined) ?? {};
  const login = actorLogin(who(ctx)!);
  const u = ctx.row('user', login);
  const time = typeof given.date === 'string' && !Number.isNaN(Date.parse(given.date)) ? Math.floor(Date.parse(given.date) / 1000) : Math.floor(Date.parse(ctx.occurredAt) / 1000);
  const tagger = { name: String(given.name ?? u?.name ?? login), email: String(given.email ?? u?.email ?? `${login}@users.noreply.github.com`), time, tz: '+0000' };
  const sha = await store.write('tag', git.encodeTag({ object, type, tag, tagger, message: message.endsWith('\n') ? message : `${message}\n` }));
  const full = String(repo.full_name);
  return json({
    node_id: btoa(`03:Tag${sha}`), tag, sha, url: `https://api.github.com/repos/${full}/git/tags/${sha}`, message: message.endsWith('\n') ? message : `${message}\n`,
    tagger: { name: tagger.name, email: tagger.email, date: new Date(time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') },
    object: { type, sha: object, url: `https://api.github.com/repos/${full}/git/${type === 'tree' ? 'trees' : type === 'blob' ? 'blobs' : 'commits'}/${object}` },
    verification: { verified: false, reason: 'unsigned', signature: null, payload: null, verified_at: null },
  }, 201);
}
