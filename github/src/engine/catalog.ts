// The first-party OAuth apps every GitHub account can sign in to, by client id.

/** GitHub's own OAuth apps every account can sign in to: the GitHub CLI, whose device flow `gh auth login` runs with its
 *  client id (cli/cli internal/authflow/flow.go, `oauthClientID`) and default scopes (`repo`, `read:org`, `gist`). */
export const FIRST_PARTY_OAUTH_APPS: Record<string, { name: string; owner: string; url: string }> = {
  '178c6fc778ccc68e1d6a': { name: 'GitHub CLI', owner: 'github', url: 'https://cli.github.com' },
};
