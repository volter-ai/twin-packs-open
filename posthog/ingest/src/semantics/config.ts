// PostHog's remote config: the project's SDK configuration, which Django's RemoteConfig builds from the project's
// settings (posthog/models/remote_config.py `build_config`) and syncs into the config cache whenever the project is
// saved, and which the hypercache server answers from that cache at GET /array/:token/config (the JSON) and
// /array/:token/config.js (the JSON wrapped in the script posthog-js loads). The World holds the project, so it holds
// its config: built from the project row at the settings it holds (shared.ts clientConfig), PostHog's defaults for a
// project nobody has configured (the World has no operation that changes them). /flags?config=true passes the same
// config through (flags.ts).
import type { HandlerContext } from '@volter/world-core';
import { apiManifest, clientConfig, projectByToken, type Row } from './shared.ts';

const plain = (status: number, message: string): Response => new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/token.rs "Matches Django's `BaseRemoteConfigAPIView.check_token`."
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/token.rs "Token not provided"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/token.rs "Token too long"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/token.rs "Invalid token format"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "TokenError::Empty => StatusCode::UNAUTHORIZED,"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "TokenError::TooLong | TokenError::InvalidCharacters => StatusCode::BAD_REQUEST,"
// A token that names no project has no cached config (Django's loader answers it missing): the server's 404, empty.
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/models/remote_config.py "except (Team.DoesNotExist, RemoteConfig.DoesNotExist):"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "/// - 404 for unknown tokens (cache miss / explicit missing marker)"
async function projectOf(ctx: HandlerContext): Promise<{ token: string; project: Row } | Response> {
  const token = String(ctx.call.params.token ?? '');
  if (token === '') return plain(401, 'Token not provided');
  if (token.length > 200) return plain(400, 'Token too long');
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return plain(400, 'Invalid token format');
  const project = projectByToken(await ctx.over(apiManifest), token);
  return project ? { token, project } : new Response(null, { status: 404 });
}

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "fn config_cache_headers() -> [(&'static str, &'static str); 2] {"
const cacheHeaders = { 'cache-control': 'public, max-age=300', vary: 'Origin, Referer' };

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/router.rs "any(remote_config::config_endpoint)"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "(StatusCode::OK, config_cache_headers(), Json(config)).into_response()"
export async function remoteConfig(ctx: HandlerContext): Promise<Response> {
  const found = await projectOf(ctx);
  if (found instanceof Response) return found;
  return new Response(JSON.stringify(clientConfig(found.project)), { status: 200, headers: { 'content-type': 'application/json', ...cacheHeaders } });
}

// The script wraps the config without siteApps (the script carries the site apps' code instead: none).
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/router.rs "any(remote_config::config_js_endpoint),"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "// Remove siteApps (minimal metadata) — the JS version has the full JS instead"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/hypercache-server/src/api/remote_config.rs "window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {{}};"
export async function remoteConfigJs(ctx: HandlerContext): Promise<Response> {
  const found = await projectOf(ctx);
  if (found instanceof Response) return found;
  const { siteApps: _apps, ...config } = clientConfig(found.project);
  const js = `(function() {\n  window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {};\n  window._POSTHOG_REMOTE_CONFIG['${found.token}'] = {\n    config: ${JSON.stringify(config)},\n    siteApps: []\n  }\n})();`;
  return new Response(js, { status: 200, headers: { 'content-type': 'application/javascript', ...cacheHeaders } });
}
