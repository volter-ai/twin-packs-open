// An app manifest as Slack validates it (https://docs.slack.dev/reference/app-manifest): what it requires, and the
// errors apps.manifest.validate and .create answer for one that falls short, each with its JSON pointer
// (`{"ok": false, "error": "invalid_manifest", "errors": [{"message": …, "pointer": "/display_information"}]}`).

type Row = Record<string, unknown>;
export type ManifestError = { message: string; pointer: string };

const isObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a manifest lacks or holds wrongly: `display_information` and its `name` (required, at most 35 characters), a
 *  bot user's `display_name` when the manifest asks for bot scopes, each slash command's `/command`, `url` and
 *  `description`, and scopes as lists of strings. */
export function manifestErrors(m: unknown): ManifestError[] {
  if (!isObject(m)) return [{ message: 'must be an object', pointer: '/' }];
  const out: ManifestError[] = [];
  const info = m.display_information;
  if (!isObject(info)) out.push({ message: 'Must have required property \'display_information\'', pointer: '/display_information' });
  else if (typeof info.name !== 'string' || !info.name.trim()) out.push({ message: 'Must have required property \'name\'', pointer: '/display_information/name' });
  else if (info.name.length > 35) out.push({ message: 'Must NOT have more than 35 characters', pointer: '/display_information/name' });
  const scopes = isObject(m.oauth_config) && isObject(m.oauth_config.scopes) ? m.oauth_config.scopes : {};
  for (const kind of ['bot', 'user'] as const) {
    const list = scopes[kind];
    if (list !== undefined && (!Array.isArray(list) || list.some((s) => typeof s !== 'string'))) out.push({ message: 'Must be an array of strings', pointer: `/oauth_config/scopes/${kind}` });
  }
  const features = isObject(m.features) ? m.features : {};
  const botScopes = Array.isArray(scopes.bot) ? scopes.bot : [];
  if (botScopes.length > 0 && botScopes.some((s) => s !== 'incoming-webhook') && !(isObject(features.bot_user) && typeof features.bot_user.display_name === 'string')) {
    out.push({ message: 'A bot user is required when bot scopes are requested', pointer: '/features/bot_user' });
  }
  const commands = features.slash_commands;
  if (Array.isArray(commands)) {
    commands.forEach((c, i) => {
      if (!isObject(c) || typeof c.command !== 'string' || !c.command.startsWith('/')) out.push({ message: 'Must match pattern "^/"', pointer: `/features/slash_commands/${i}/command` });
      else if (typeof c.description !== 'string') out.push({ message: 'Must have required property \'description\'', pointer: `/features/slash_commands/${i}/description` });
    });
  }
  return out;
}

/** The slash commands a manifest declares. */
export function commandsOf(m: Row): Array<{ command: string; url: string; description: string }> {
  const features = isObject(m.features) ? m.features : {};
  return Array.isArray(features.slash_commands) ? (features.slash_commands as Row[]).map((c) => ({ command: String(c.command), url: String(c.url ?? ''), description: String(c.description ?? '') })) : [];
}

/** A manifest's redirect URLs. */
export const redirectsOf = (m: Row): string[] => (isObject(m.oauth_config) && Array.isArray(m.oauth_config.redirect_urls) ? m.oauth_config.redirect_urls.map(String) : []);

/** An app's name as its manifest gives it. */
export const appName = (m: Row): string => String((isObject(m.display_information) ? m.display_information.name : undefined) ?? 'App');

/** Whether an app may be installed on a whole org ("org_deploy_enabled"). */
export const orgReady = (m: Row): boolean => isObject(m.settings) && m.settings.org_deploy_enabled === true;
