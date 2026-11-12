// The posthog-js bundles PostHog serves from its static files (STATIC_URL /static/): the files PostHog copies from
// posthog-js's dist into its static files, carried byte for byte in the pack (../../../vendor/posthog-js/dist, the
// version and its source in journeys/decisions.json, staticAsset), read through the pack-asset seam. posthog-js loads
// its lazy extensions from here (surveys.js, the recorder, web vitals), from the assets host.
import { packAsset, type HandlerContext } from '@volter/world-core';

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/settings/web.py "STATIC_URL = \"/static/\""
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/frontend/bin/copy-posthog-js "This script copies the following built files from posthog-js so that they can served on PostHog's CDN"
// WhiteNoise answers /static/ (its middleware stands above the CORS middleware): every file is readable from any
// origin, typed by its extension (.js text/javascript in utf-8, .map unlisted, so application/octet-stream), cached
// for PostHog's WHITENOISE_MAX_AGE, and varied on Origin by PostHog's own headers function.
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/settings/web.py "\"whitenoise.middleware.WhiteNoiseMiddleware\","
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/settings/web.py "headers[\"Vary\"] = \"Accept-Encoding, Origin\""
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/settings/web.py "WHITENOISE_MAX_AGE = get_from_env(\"WHITENOISE_MAX_AGE\", 3600, type_cast=int)"
// source: https://raw.githubusercontent.com/evansd/whitenoise/6.10.0/src/whitenoise/base.py "headers[\"Access-Control-Allow-Origin\"] = \"*\""
// source: https://raw.githubusercontent.com/evansd/whitenoise/6.10.0/src/whitenoise/base.py "headers[\"Cache-Control\"] = f\"max-age={self.max_age}, public\""
// source: https://raw.githubusercontent.com/evansd/whitenoise/6.10.0/src/whitenoise/media_types.py "\".js\": \"text/javascript\","
// source: https://raw.githubusercontent.com/evansd/whitenoise/6.10.0/src/whitenoise/media_types.py "return self.types_map.get(extension, \"application/octet-stream\")"
// A file outside PostHog's static files is the ingest lane's own not-found: the capture router's unregistered route,
// an empty 404 (manifest.ts notFound).
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs "unregistered (404)"
export async function staticAsset(ctx: HandlerContext): Promise<Response> {
  const file = String(ctx.call.params.file ?? '');
  const asset = /^[A-Za-z0-9._-]+\.js(?:\.map)?$/.test(file) ? await packAsset('posthog', `vendor/posthog-js/dist/${file}`) : null;
  if (asset === null) return new Response(null, { status: 404 });
  return new Response(asset.body, { status: 200, headers: {
    'content-type': file.endsWith('.js') ? 'text/javascript; charset="utf-8"' : 'application/octet-stream',
    'cache-control': 'max-age=3600, public',
    'access-control-allow-origin': '*',
    vary: 'Accept-Encoding, Origin',
  } });
}
