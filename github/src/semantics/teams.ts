// GitHub's teams (https://docs.github.com/en/rest/teams): a team made in an organization with its maker as maintainer,
// its repositories and their permission, and its members (pending until they are members of the organization).
import type { HandlerContext } from '@volter/world-core';
import { nodeId, roleOf, simpleOrg } from '../engine/objects.ts';
import { bodyOf, ensureUser, fail, hasScope, invalid, json, membershipOf, mint, noContent, notFound, nowIso, page, repoNamed, type Row, shown, str, who } from './shared.ts';

/** A team's members or repositories, counted from their subjects (one per member, one per repository). */
const teamCount = (ctx: HandlerContext, type: 'team_member' | 'team_repo', team: string): number => ctx.rowsRaw(type).filter((x) => x._team === team && x.deleted !== true).length;

/** A team membership as answered: stored under `<team>::<login>`, a key GitHub's membership does not carry. */
const membershipAnswer = (ctx: HandlerContext, m: Row): Row => { const { id: _key, ...own } = shown(ctx, m); return own; };

/** A team's organization as GitHub names it on the team: its public profile (team-organization), not its billing. */
// source: spec:/components/schemas/team-full "Groups of organization members that gives permissions on specified repositories."
const teamOrganization = (o: Row): Row => ({
  ...simpleOrg(o), ...Object.fromEntries(['name', 'company', 'blog', 'location', 'email', 'twitter_username', 'is_verified', 'has_organization_projects', 'has_repository_projects',
    'public_repos', 'public_gists', 'followers', 'following', 'html_url', 'created_at', 'updated_at', 'archived_at', 'type'].map((k) => [k, o[k] ?? null])),
});

/** A team of an organization by its slug. */
const teamOf = (ctx: HandlerContext, org: string, slug: string): Row | undefined => ctx.rowsRaw('team').find((t) => String((t.organization as Row).login) === org && t.slug === slug);

/** A person's membership of a team, active when they are an active member of its organization, else pending. */
// source: https://docs.github.com/en/rest/teams/members "This newly-created membership will be in the "pending" state until the person accepts the invitation, at which point the membership will transition to the "active" state and the user will be added as a member of the team."
async function addMember(ctx: HandlerContext, team: Row, org: string, login: string, role: string): Promise<Row> {
  const active = membershipOf(ctx, org, login)?.state === 'active';
  const held = ctx.row('team_member', `${String(team.id)}::${login}`);
  return ctx.write('team_member', `${String(team.id)}::${login}`, {
    url: `https://api.github.com/organizations/${String((team.organization as Row).id)}/team/${String(team.id)}/memberships/${login}`, role, state: held?.state === 'active' || active ? 'active' : 'pending',
    _team: String(team.id), _login: login,
  }, held ? 'membership.updated' : 'membership.added');
}

/** teams/create: a team (secret unless named closed) with its maker as maintainer, the named maintainers, and the named
 *  repositories at `pull` (201). Where the documentation stops: the refusals' words are GitHub's. */
// source: https://docs.github.com/en/rest/teams/teams "To create a team, the authenticated user must be a member or owner of {org} ."
// source: https://docs.github.com/en/rest/teams/teams "When you create a new team, you automatically become a team maintainer without explicitly adding yourself to the optional array of maintainers ."
// source: https://docs.github.com/en/rest/teams/teams "secret - only visible to organization owners and members of this team. closed - visible to all members of this organization. Default: secret"
// source: https://docs.github.com/en/rest/teams/teams "notifications_enabled - team members receive notifications when the team is @mentioned. notifications_disabled - no one receives notifications. Default: notifications_enabled"
// source: https://docs.github.com/en/rest/teams/teams "The full name (e.g., "organization-name/repository-name") of repositories to add the team to."
export async function teams_create(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  const o = ctx.row('org', org);
  if (!o) return notFound(ctx);
  const c = who(ctx);
  if (c?.kind !== 'user' || membershipOf(ctx, org, c.login)?.state !== 'active') return fail(ctx, 403, 'You must be a member of the organization to create a team.');
  const b = bodyOf(ctx);
  const name = str(b.name);
  if (!name) return invalid('Team', 'name', 'missing_field');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (teamOf(ctx, org, slug)) return invalid('Team', 'name', 'already_exists', 'Name must be unique for this org');
  const id = mint(ctx, 'team-full');
  const url = `https://api.github.com/organizations/${String(o.id)}/team/${id}`;
  const at = nowIso(ctx);
  const repos = ((b.repo_names as string[] | undefined) ?? []).map((n) => repoNamed(ctx, n.includes('/') ? n.split('/')[0]! : org, n.split('/').pop()!));
  if (repos.some((r) => !r)) return invalid('Team', 'repo_names', 'invalid');
  // source: spec:/components/schemas/team-full/properties/type "organization"
  let team = await ctx.write('team', String(id), {
    id, type: 'organization', node_id: nodeId('Team', id), url, html_url: `https://github.com/orgs/${org}/teams/${slug}`, name, slug, description: str(b.description) ?? null,
    privacy: str(b.privacy) ?? 'secret', notification_setting: str(b.notification_setting) ?? 'notifications_enabled', permission: str(b.permission) ?? 'pull',
    members_url: `${url}/members{/member}`, repositories_url: `${url}/repos`, parent: null, members_count: 0, repos_count: repos.length, created_at: at, updated_at: at, organization: teamOrganization(ctx.own(o)),
  }, 'team.created');
  const members = [c.login, ...((b.maintainers as string[] | undefined) ?? []).filter((m) => m !== c.login)];
  for (const m of members) { await ensureUser(ctx, m); await addMember(ctx, team, org, m, 'maintainer'); }
  for (const r of repos as Row[]) await ctx.write('team_repo', `${String(id)}::${String(r.id)}`, { permission: 'pull', _team: String(id), _repository_id: String(r.id) }, 'team.added_to_repository');
  team = await ctx.write('team', String(id), { members_count: teamCount(ctx, 'team_member', String(id)) }, 'team.members');
  return json(shown(ctx, team), 201);
}

/** teams/add-or-update-repo-permissions-in-org: the team given a repository of the organization at a role (the team's
 *  own permission unless named) (204); a repository the organization does not own, 422. */
// source: https://docs.github.com/en/rest/teams/teams "If no permission is specified, the team's permission attribute will be used to determine what permission to grant the team on this repository."
// source: https://docs.github.com/en/rest/teams/teams "You will get a 422 Unprocessable Entity status if you attempt to add a repository to a team that is not owned by the organization."
export async function teams_add_or_update_repo_permissions_in_org(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  const team = teamOf(ctx, org, String(ctx.call.params.team_slug ?? ''));
  const repo = repoNamed(ctx, String(ctx.call.params.owner ?? ''), String(ctx.call.params.repo ?? ''));
  if (!team || !repo) return notFound(ctx);
  if (String((repo.owner as Row).login) !== org) return fail(ctx, 422, 'Repository must be owned by the organization');
  const permission = str(bodyOf(ctx).permission) ?? String(team.permission ?? 'pull');
  if (!roleOf(permission)) return invalid('Team', 'permission', 'invalid');
  const key = `${String(team.id)}::${String(repo.id)}`;
  const held = ctx.row('team_repo', key);
  await ctx.write('team_repo', key, { permission, _team: String(team.id), _repository_id: String(repo.id) }, held ? 'team.edited' : 'team.added_to_repository');
  if (!held) await ctx.write('team', String(team.id), { repos_count: teamCount(ctx, 'team_repo', String(team.id)) }, 'team.repos');
  return noContent();
}

/** teams/add-or-update-membership-for-user-in-org: a person on the team as `member` or `maintainer`; pending until they
 *  are an active member of the organization. */
// source: https://docs.github.com/en/rest/teams/members "Adds an organization member to a team. An authenticated organization owner or team maintainer can add organization members to a team."
// source: https://docs.github.com/en/rest/teams/members "If the user is already a member of the team, this endpoint will update the role of the team member's role."
export async function teams_add_or_update_membership_for_user_in_org(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  const team = teamOf(ctx, org, String(ctx.call.params.team_slug ?? ''));
  if (!team) return notFound(ctx);
  const login = String(ctx.call.params.username ?? '');
  const role = str(bodyOf(ctx).role) ?? 'member';
  if (role !== 'member' && role !== 'maintainer') return invalid('TeamMembership', 'role', 'invalid');
  await ensureUser(ctx, login);
  const fresh = !ctx.row('team_member', `${String(team.id)}::${login}`);
  await addMember(ctx, team, org, login, role);
  if (fresh) await ctx.write('team', String(team.id), { members_count: teamCount(ctx, 'team_member', String(team.id)) }, 'team.members');
  return json(membershipAnswer(ctx, ctx.row('team_member', `${String(team.id)}::${login}`)!));
}

/** teams/list-for-authenticated-user: every team the caller is an active member of, across its organizations, to a
 *  person's token with `user`, `repo` or `read:org`; an App's or a run's token is no person. */
// source: https://docs.github.com/en/rest/teams/teams "List all of the teams across all of the organizations to which the authenticated user belongs."
// source: https://docs.github.com/en/rest/teams/teams "OAuth app tokens and personal access tokens (classic) need the user , repo , or read:org scope to use this endpoint."
export async function teams_list_for_authenticated_user(ctx: HandlerContext): Promise<Response> {
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  if (c.kind !== 'user') return fail(ctx, 403, 'Resource not accessible by integration');
  // Where the documentation stops: a token with none of the scopes is refused with GitHub's 403 for a missing scope
  if (!['user', 'repo', 'read:org'].some((s) => hasScope(c, s))) return fail(ctx, 403, 'Resource not accessible by personal access token');
  const teams = ctx.rowsRaw('team_member').filter((m) => m._login === c.login && m.state === 'active' && m.deleted !== true)
    .map((m) => ctx.row('team', String(m._team))).filter((t): t is Row => t !== undefined && t.deleted !== true);
  return json(page(ctx, teams).map((row) => shown(ctx, row)));
}
