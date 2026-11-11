// PostHog's flags service (rust/feature-flags): POST /flags evaluates the project's feature flags for a distinct id,
// with the project token, and with `config=true` adds the SDK configuration posthog-js starts from. The body is JSON,
// a form whose `data` is base64 (posthog-js's default `compression=base64`) or gzip.
import { s3, type HandlerContext } from '@volter/world-core';
import { apiManifest, clientConfig, decodeJson, obj, projectByToken } from './shared.ts';

const plain = (status: number, message: string): Response => new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/errors.rs "Structured error response matching Django REST Framework's format"
const unauthorized = (code: string, detail: string): Response => Response.json({ type: 'authentication_error', code, detail, attr: null }, { status: 401 });

// source: https://posthog.com/docs/api/flags "The flags endpoint is used to evaluate feature flags for a given distinct_id ."
// source: https://posthog.com/docs/api/flags "It is a POST-only public endpoint that uses your project token and does not return any sensitive data from your PostHog instance."
export async function evaluateFlags(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const decoded = await decodeJson(request, url, s3.bytesOf(request));
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/errors.rs "Please check your request format and try again."
  if ('error' in decoded) return plain(400, `Failed to decode request: ${decoded.error}. Please check your request format and try again.`);
  const body = obj(decoded.json);
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/handler/authentication.rs "let token = request.extract_token()?;"
  const token = [body.token, body.api_key].find((t) => typeof t === 'string' && t !== '') as string | undefined;
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/errors.rs "No API token provided. Please include a valid API token in your request."
  if (!token) return unauthorized('not_authenticated', 'No API token provided. Please include a valid API token in your request.');
  const over = await ctx.over(apiManifest);
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/handler/authentication.rs "let team = flag_service.verify_token_and_get_team(&token).await?;"
  const project = projectByToken(over, token);
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/errors.rs "The provided API key is invalid or has expired. Please check your API key and try again."
  if (!project) return unauthorized('authentication_failed', 'The provided API key is invalid or has expired. Please check your API key and try again.');
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/handler/authentication.rs "Only validate distinct_id if flags are NOT disabled"
  const distinct = body.distinct_id;
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/errors.rs "The distinct_id field is missing from the request. Please include a valid identifier."
  if (body.disable_flags !== true && (distinct === undefined || distinct === null || String(distinct) === '')) return plain(400, 'The distinct_id field is missing from the request. Please include a valid identifier.');
  let v = url.searchParams.get('v');
  let config = url.searchParams.get('config');
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/endpoint.rs "Default to v=2 and config=true when both params are missing"
  if (v === null && config === null) { v = '2'; config = 'true'; }
  const version = v === null ? 1 : Number.parseInt(v, 10) || 1;
  // The project's flags: none. Where the documentation stops: a flag is made through the private API's feature flags
  // operations, which no demanded caller makes (they are unmodeled), so the World's project holds no flag and every
  // evaluation answers an empty set.
  const flags = {};
  const requestId = ctx.crypto.uuidFrom(`posthog-flags:${ctx.occurredAt}:${token}:${String(distinct ?? '')}:${url.search}`);
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/types.rs "Timestamp when flags were evaluated, in milliseconds since Unix epoch"
  const evaluatedAt = Date.parse(ctx.occurredAt);
  // With config=true the SDK's configuration is added at the top level: the flags service passes through the project's
  // cached remote config, sanitized for the client, which the World holds as it holds the project (config.ts builds it,
  // and /array/:token/config answers the same).
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/handler/config_response_builder.rs "Passed through cached config from HyperCache"
  const configured = config === 'true' ? clientConfig(project) : {};
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/endpoint.rs "v>=2 -> FlagsV2 response format"
  if (version >= 2) return Response.json({ errorsWhileComputingFlags: false, flags, requestId, evaluatedAt, ...configured });
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/api/endpoint.rs "v=1 or missing -> FlagsV1 response format"
  return Response.json({ errorsWhileComputingFlags: false, featureFlags: flags, featureFlagPayloads: {}, requestId, evaluatedAt, ...configured });
}
