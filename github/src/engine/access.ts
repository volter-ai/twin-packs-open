// The repository role each operation under /repos/{owner}/{repo} needs of a person, as GitHub's roles grant it
// (https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization):
// read the repository to see anything of it (a private one is Not Found to anyone else), and the role named here to
// change it. An operation not named needs only read. What an App's installation or a run's token may do is its
// permission of the same name (`permissionOf`), `write` for a change.
import type { Role } from './objects.ts';

export const ROLE_NEEDED: Record<string, Role> = {
  // issues: anyone who can read opens issues and comments; triage labels and assigns; write manages labels and milestones
  'issues/add-labels': 'triage', 'issues/remove-label': 'triage', 'issues/create-label': 'write', 'issues/create-milestone': 'write', 'issues/update-milestone': 'write',
  // pulls: anyone who can read opens pull requests and reviews them; write merges
  'pulls/merge': 'write',
  // repositories
  'repos/update': 'admin', 'repos/transfer': 'admin', 'repos/add-collaborator': 'admin', 'repos/update-branch-protection': 'admin', 'repos/create-pages-site': 'admin',
  'repos/update-information-about-pages-site': 'admin', 'repos/enable-vulnerability-alerts': 'admin', 'repos/list-webhooks': 'admin', 'repos/get-webhook': 'admin',
  'repos/create-release': 'write', 'repos/update-release': 'write', 'repos/delete-release': 'write', 'repos/upload-release-asset': 'write', 'repos/delete-release-asset': 'write',
  'repos/create-deployment': 'write', 'repos/create-deployment-status': 'write', 'repos/merge-upstream': 'write', 'repos/create-attestation': 'write', 'repos/create-pages-deployment': 'write',
  'git/create-ref': 'write', 'git/create-tag': 'write', 'repos/create-or-update-file-contents': 'write', 'repos/create-commit-status': 'write',
  // a repository's settings: deploy keys, rulesets, webhooks, environments and their branch policies are an admin's
  'repos/create-deploy-key': 'admin', 'repos/list-deploy-keys': 'admin', 'repos/create-repo-ruleset': 'admin', 'repos/update-repo-ruleset': 'admin', 'repos/create-webhook': 'admin',
  'repos/list-webhook-deliveries': 'admin', 'repos/create-or-update-environment': 'admin', 'repos/list-deployment-branch-policies': 'admin', 'repos/create-deployment-branch-policy': 'admin',
  'repos/delete-deployment-branch-policy': 'admin',
  // a draft advisory is its repository's admins' (and security managers') to write and publish
  'security-advisories/create-repository-advisory': 'admin', 'security-advisories/update-repository-advisory': 'admin',
  // Actions: "collaborator access" (write) for secrets and runs
  'actions/get-repo-public-key': 'write', 'actions/create-or-update-repo-secret': 'write', 'actions/list-repo-secrets': 'write', 'actions/approve-workflow-run': 'write',
  'actions/re-run-workflow': 'write', 'actions/cancel-workflow-run': 'write', 'actions/delete-workflow-run': 'write', 'actions/create-workflow-dispatch': 'write',
  'actions/get-environment-public-key': 'write', 'actions/create-or-update-environment-secret': 'write', 'actions/list-environment-secrets': 'write',
  'actions/create-repo-variable': 'write', 'actions/update-repo-variable': 'write',
  // security: alerts are the writers' to read; an analysis is uploaded by a writer
  'dependabot/list-alerts-for-repo': 'write', 'dependabot/get-alert': 'write', 'code-scanning/upload-sarif': 'write', 'code-scanning/list-alerts-for-repo': 'write', 'code-scanning/get-alert': 'write',
};

/** The App or run permission an operation's change needs, by its family (`issues`, `pull_requests`, `contents`…). */
export const PERMISSION_OF: Record<string, string> = {
  issues: 'issues', pulls: 'pull_requests', repos: 'contents', git: 'contents', actions: 'actions', checks: 'checks', 'code-scanning': 'security_events', dependabot: 'vulnerability_alerts',
};
/** Operations whose permission is not their family's. */
export const PERMISSION_FOR: Record<string, string> = {
  'repos/create-deployment': 'deployments', 'repos/create-deployment-status': 'deployments', 'repos/create-pages-deployment': 'pages', 'repos/create-pages-site': 'pages',
  'repos/update-information-about-pages-site': 'pages', 'repos/create-attestation': 'attestations', 'actions/create-or-update-repo-secret': 'secrets', 'actions/list-repo-secrets': 'secrets',
  'actions/get-repo-public-key': 'secrets', 'repos/list-webhooks': 'administration', 'repos/get-webhook': 'administration', 'issues/create-comment': 'issues',
  'actions/get-environment-public-key': 'secrets', 'actions/create-or-update-environment-secret': 'secrets', 'actions/list-environment-secrets': 'secrets',
  'actions/create-repo-variable': 'variables', 'actions/update-repo-variable': 'variables', 'repos/create-commit-status': 'statuses', 'repos/create-deploy-key': 'administration',
  'repos/list-deploy-keys': 'administration', 'repos/create-repo-ruleset': 'administration', 'repos/update-repo-ruleset': 'administration', 'repos/create-webhook': 'administration',
  'repos/list-webhook-deliveries': 'administration', 'repos/create-or-update-environment': 'administration', 'repos/list-deployment-branch-policies': 'administration',
  'repos/create-deployment-branch-policy': 'administration', 'repos/delete-deployment-branch-policy': 'administration',
  'security-advisories/create-repository-advisory': 'repository_advisories', 'security-advisories/update-repository-advisory': 'repository_advisories',
};
/** An App permission's levels, least first ("none", "read", "write", "admin"): a token may be given a level its
 *  installation holds, or a lower one. */
export const PERMISSION_LEVELS = ['none', 'read', 'write', 'admin'];
