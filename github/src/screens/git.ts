// GIT OVER HTTP — github.com/{owner}/{repo}.git (a content host, docs/contributing/architecture.md, "Screens"): git's
// smart HTTP protocol (https://git-scm.com/docs/http-protocol) over the repository's git data in the World (ctx.git),
// the objects the REST API's git and contents operations read. A clone or fetch of a public repository is anyone's; of a
// private one, and every push, git is asked for a credential (Basic, the password a token) and it must reach the
// repository — a push needs write access. A push that changes a workflow file by a token without the `workflow` scope
// is refused, and so is one a ruleset over the ref refuses (GH013); what it lands sets off what a push does (shared.ts,
// pushed).
import { git, type HandlerContext } from '@volter/world-core';
import { actorLogin, callerOf, gitOf, pushed, repoNamed, roleIn, rulesetPushRefusal, type Caller } from '../semantics/shared.ts';

const challenge = (): Response => new Response('Authentication failed\n', { status: 401, headers: { 'www-authenticate': 'Basic realm="GitHub"', 'content-type': 'text/plain' } });
const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

/** The caller a git request's Basic credentials name (a token as the password; `x-access-token` and any username). */
function gitCaller(ctx: HandlerContext): Caller | 'bad' | undefined {
  const m = /^basic\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '');
  if (!m) return callerOf(ctx);
  let password = '';
  try { password = atob(m[1]!).split(':').slice(1).join(':'); } catch { return 'bad'; }
  return password ? callerOf(ctx, password) : undefined;
}

/** Whether a caller may change workflow files: a person's token with the `workflow` scope (their own holds all), an App
 *  granted `workflows: write` ("refusing to allow … to create or update workflow … without `workflow` scope"). */
function mayChangeWorkflows(c: Caller): boolean {
  if (c.kind === 'user') return c.scopes === '*' || c.scopes.includes('workflow');
  if (c.kind === 'installation') return c.permissions.workflows === 'write';
  return false;
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const m = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(new URL(ctx.call.request.url).pathname);
  if (!m) return new Response(JSON.stringify({ message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const repo = repoNamed(ctx, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
  const tail = m[3]!;
  const pushing = tail === 'git-receive-pack' || new URL(ctx.call.request.url).searchParams.get('service') === 'git-receive-pack';
  const caller = gitCaller(ctx);
  if (caller === 'bad') return challenge();
  if (!repo) return caller ? text(404, 'Repository not found.\n') : challenge();
  const role = roleIn(ctx, repo, caller);
  if (!role) return caller ? text(404, 'Repository not found.\n') : challenge();
  if (pushing) {
    if (!caller) return challenge();
    if (!['write', 'maintain', 'admin'].includes(role)) return text(403, `Permission to ${String(repo.full_name)}.git denied to ${actorLogin(caller)}.\n`);
  }
  const { store, refs } = gitOf(ctx, repo);
  const actor = caller ? actorLogin(caller) : 'anonymous';
  const answer = await git.serveSmartHttp(ctx.call.request, {
    store, refs,
    policy: async (cmd) => {
      if (cmd.new !== git.ZERO_SHA && caller && !mayChangeWorkflows(caller)) {
        const oldTree = cmd.old === git.ZERO_SHA ? null : git.decodeCommit((await store.read(cmd.old))!.payload).tree;
        const top = await store.read(cmd.new);
        if (top?.type === 'commit') {
          const changes = await git.diffTrees(store, oldTree, git.decodeCommit(top.payload).tree);
          const wf = changes.find((c) => /^\.github\/workflows\//.test(c.path));
          if (wf) return `refusing to allow ${caller.kind === 'user' ? 'a Personal Access Token' : 'a GitHub App'} to create or update workflow \`${wf.path}\` without \`workflow\` scope`;
        }
      }
      // a ruleset over the ref, unless the pusher may bypass it
      return rulesetPushRefusal(ctx, repo, caller, cmd);
    },
    onPush: (applied) => pushed(ctx, repo, applied.map((c) => ({ name: c.name, old: c.old, new: c.new })), actor),
  }, tail);
  return answer ?? text(404, 'Not Found\n');
}
