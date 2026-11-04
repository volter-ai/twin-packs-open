// The Hub's /api family: a model repository created (under the token's account, or an organization it names; its git
// repository empty until it is pushed to), and the resolve cache answering a regular file's bytes at a commit.
import { git, type HandlerContext } from '@volter/world-core';
import { fileAt, gitOf, ranged, REPO, type Row, userOf } from './shared.ts';

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});

// source: spec:post_api_repos_create "Create repository"
export async function post_api_repos_create(ctx: HandlerContext): Promise<Response> {
  const user = userOf(ctx);
  // Where the documentation stops: the words are the ones huggingface.co answers a missing or unknown token
  if (!user) return Response.json({ error: 'Invalid username or password.' }, { status: 401 });
  const b = obj(ctx.body);
  // Where the documentation stops: a name is letters, digits, _, . and -, as the Hub's own names are
  if (typeof b.name !== 'string' || !/^[\w.-]{1,96}$/.test(b.name)) return Response.json({ error: 'Invalid repository name' }, { status: 400 });
  // Where the documentation stops: the twin models model repositories; a dataset or a Space is the gap
  if (b.type !== undefined && b.type !== 'model') return ctx.refuse({ status: 404, message: 'Not Found' });
  // Where the documentation stops: an organization is the account's own namespace in the twin; another is refused
  const namespace = typeof b.organization === 'string' && b.organization ? b.organization : String(user.name);
  if (namespace !== user.name) return Response.json({ error: `You don't have the rights to create a model under the namespace "${namespace}"` }, { status: 403 });
  // source: spec:post_api_repos_create "Cannot be specified along with visibility."
  if (b.private !== undefined && b.visibility !== undefined) return Response.json({ error: 'private and visibility cannot be specified together' }, { status: 400 });
  // source: spec:post_api_repos_create "only supported for Spaces"
  if (b.visibility !== undefined && b.visibility !== 'public' && b.visibility !== 'private') return Response.json({ error: 'Invalid visibility for a model repository' }, { status: 400 });
  // Initial files are a stored mutation the measured workflow does not model; refuse rather than silently dropping them.
  // source: spec:post_api_repos_create "files"
  if (b.files !== undefined) return ctx.refuse({ status: 404, message: 'Not Found' });
  const name = `${namespace}/${b.name}`;
  const url = `https://huggingface.co/${name}`;
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/hf_api "Author of the model."
  // Repository metadata is stored in the vendor’s own fields, including the author returned by ModelInfo.
  // source: spec:post_api_repos_create "Repository already exists, url is given"
  const result = await ctx.createUnique(REPO, (id) => ({ id, name, url, namespace, repo: b.name, author: namespace, _private: b.private === true || b.visibility === 'private', _owner: user.id }), 'repo.create');
  // source: spec:post_api_repos_create "Repository created, url is given"
  return result.created ? Response.json({ id: result.row.id, name: result.row.name, url: result.row.url }) : Response.json({ error: 'You already created this model repo', url }, { status: 409 });
}

// source: spec:get_api_resolve_cache_models_namespace_repo_rev_path "Resolve a file"
export async function get_api_resolve_cache_models_namespace_repo_rev_path(ctx: HandlerContext): Promise<Response> {
  const f = await fileAt(ctx);
  if (f instanceof Response) return f;
  return ranged(ctx.call.request, f.blob.bytes, f.blob.sha, { 'x-repo-commit': f.commit });
}

// source: https://huggingface.co/docs/huggingface_hub/package_reference/hf_api "Get info on one specific model on huggingface.co"
export async function get_api_models_repo_id(ctx: HandlerContext): Promise<Response> {
  const row = ctx.rowsRaw(REPO).find((r) => r.deleted !== true && r.namespace === ctx.call.params.namespace && r.repo === ctx.call.params.repo);
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/hf_api "RepositoryNotFoundError"
  // The documentation gives the error class; its exact JSON words are not promised.
  if (!row || (row._private && userOf(ctx)?.id !== row._owner)) return Response.json({ error: 'Repository Not Found' }, { status: 404 });
  const own = ctx.own(row);
  const repository = gitOf(ctx, row);
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/hf_api "Repo SHA at this particular revision."
  const sha = repository.refs.get('refs/heads/main');
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/hf_api "file name, relative to the repo root."
  const siblings = sha ? (await git.diffTrees(repository.store, null, sha)).map((f) => ({ rfilename: f.path })) : [];
  // source: https://huggingface.co/docs/huggingface_hub/package_reference/hf_api "Author of the model."
  // The creation reply and ModelInfo use different identity fields: ObjectId versus namespace/name.
  return Response.json({ _id: row.id, id: own.name, author: own.author, private: row._private === true, sha: sha ?? null, siblings });
}
