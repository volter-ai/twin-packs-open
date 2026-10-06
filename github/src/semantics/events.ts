// How GitHub renders the webhooks its writes send (the manifest's `events`): the event's payload, its `action`, the
// object it is about, the repository and the account that caused it, and the values the manifest's endpoints and
// headers read (which repository, owner and installation it is about; its delivery id). A write's operation names its
// action: `<stored type>.<action>`.
import type { EventWrite, WriteHookContext } from '@volter/world-core';
import { actorLogin, who, shown as ownShown } from './shared.ts';

type Row = Record<string, unknown>;

/** The payload key each stored type's object goes under. */
// source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "pull_request object Required"
// source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "comment object Required"
// source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "check_run object Required"
const KEY: Record<string, string> = {
  issue: 'issue', issue_comment: 'comment', label: 'label', pull: 'pull_request', review: 'review', release: 'release', check_run: 'check_run',
  workflow_run: 'workflow_run', installation: 'installation', discussion: 'discussion', discussion_comment: 'comment', repository: 'repository',
  workflow_job: 'workflow_job', org_membership: 'membership', team: 'team', milestone: 'milestone',
};

/** The action a write's operation names (`issue.opened` → `opened`; a push's record names none). */
const actionOf = (operation: string): string | undefined => {
  const a = operation.slice(operation.indexOf('.') + 1);
  return a === 'record' ? undefined : a;
};

/** The written subject as it is kept, its bookkeeping with it (a write's body is its rendered view). */
const stored = (ctx: WriteHookContext, write: EventWrite): Row => ctx.row(write.storedType, String(write.body.id ?? '')) ?? write.body;

/** The repository a written subject belongs to. */
function repositoryOf(ctx: WriteHookContext, write: EventWrite): Row | undefined {
  const b = stored(ctx, write);
  if (write.storedType === 'repository') return b;
  const full = typeof b._repo === 'string' ? b._repo : typeof (b.repository as Row | undefined)?.full_name === 'string' ? String((b.repository as Row).full_name) : undefined;
  return full ? ctx.rowsRaw('repository').find((r) => String(r.full_name).toLowerCase() === full.toLowerCase()) : undefined;
}

/** A subject as a payload names it: GitHub's own fields (shared.ts), never the kernel's updatedAt or bookkeeping. */
const shown = (ctx: WriteHookContext, r: Row | undefined): Row | undefined => (r ? ownShown(ctx, r) : undefined);

/** The event's payload. */
// source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "The repository on GitHub where the event occurred. Webhook payloads contain the repository property when the event occurs from activity in a repository."
// source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "sender object Required A GitHub user."
export function data(ctx: WriteHookContext, write: EventWrite): Record<string, unknown> {
  const raw = stored(ctx, write);
  const b = shown(ctx, raw)!;
  const repo = repositoryOf(ctx, write);
  const caller = who(ctx);
  const senderLogin = caller ? actorLogin(caller) : undefined;
  const sender = senderLogin ? shown(ctx, ctx.rowsRaw('user').find((u) => u.login === senderLogin)) ?? { login: senderLogin } : undefined;
  const common = { ...(repo && write.storedType !== 'repository' ? { repository: shown(ctx, repo) } : {}), ...(sender ? { sender } : {}) };
  if (write.storedType === 'push') {
    return { ref: b.ref, before: b.before, after: b.after, created: b.created, deleted: b.deleted, forced: b.forced, compare: b.compare, commits: b.commits ?? [], head_commit: b.head_commit ?? null, pusher: b.pusher, ...common };
  }
  if (write.storedType === 'commit_status') return { id: b.id, sha: raw._sha, name: repo?.full_name, context: b.context, state: b.state, description: b.description, target_url: b.target_url, ...common };
  // a team's membership: the person, the team and its organization (the `membership` event)
  if (write.storedType === 'team_member') {
    const team = ctx.row('team', String(raw._team));
    const person = ctx.rowsRaw('user').find((u) => u.login === raw._login);
    return { action: actionOf(write.operation), scope: 'team', member: shown(ctx, person), team: shown(ctx, team), organization: team ? team.organization : undefined, ...common };
  }
  const key = KEY[write.storedType] ?? write.storedType;
  const extra: Row = {};
  if (write.storedType === 'pull' || write.storedType === 'issue') extra.number = b.number;
  if (write.storedType === 'issue_comment') { const i = ctx.rowsRaw('issue').find((x) => x._repo === raw._repo && String(x.number) === String(raw._issue)); if (i) extra.issue = shown(ctx, i); }
  if (write.storedType === 'review') { const p = ctx.rowsRaw('pull').find((x) => x._repo === raw._repo && String(x.number) === String(raw._pull)); if (p) extra.pull_request = shown(ctx, p); }
  if (write.storedType === 'org_membership') { const o = ctx.row('org', String(raw._org)); if (o) extra.organization = shown(ctx, o); b.user = shown(ctx, ctx.rowsRaw('user').find((u) => u.login === raw._login)); delete b.id; }
  if (write.storedType === 'team') extra.organization = b.organization;
  if (write.storedType === 'discussion_comment') { const d = ctx.rowsRaw('discussion').find((x) => String(x.id) === String(raw._discussion)); if (d) extra.discussion = shown(ctx, d); }
  const action = actionOf(write.operation);
  return { ...(action ? { action } : {}), ...extra, [key]: b, ...(write.storedType === 'installation' ? { repositories: raw._shown_repositories ?? [] } : {}), ...common };
}

// source: https://docs.github.com/en/webhooks/webhook-events-and-payloads "X-GitHub-Delivery : A globally unique identifier (GUID) to identify the event."
/** What the endpoints are matched by and the headers read: the repository (`$repo`, as its children name it), its
 *  owner, its id, the installation an installation's own event is about, and the delivery's GUID. */
export function values(ctx: WriteHookContext, write: EventWrite, type: string): Record<string, unknown> {
  const repo = repositoryOf(ctx, write);
  const raw = stored(ctx, write);
  // an organization's own events (its memberships and teams) are its, and an installation's its account's
  const team = write.storedType === 'team_member' ? ctx.row('team', String(raw._team)) : undefined;
  const org = typeof raw._org === 'string' ? raw._org : (((team ?? raw).organization as Row | undefined)?.login as string | undefined);
  const owner = repo ? String((repo.owner as Row | undefined)?.login ?? '') : org ?? (typeof (raw.account as Row | undefined)?.login === 'string' ? String((raw.account as Row).login) : undefined);
  return {
    $repo: repo ? String(repo.full_name) : undefined, $owner: owner, $repository_id: repo ? String(repo.id) : undefined,
    $installation: write.storedType === 'installation' ? String(write.body.id) : undefined,
    $guid: ctx.crypto.uuidFrom(`delivery:${type}:${write.operation}:${write.occurredAt}:${String(write.body.id ?? '')}`),
  };
}
