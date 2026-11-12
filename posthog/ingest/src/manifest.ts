// PostHog's capture lane: the events its SDKs send (./semantics/capture.ts), kept in the vendor's one store through the
// api lane's manifest, the flags its SDKs evaluate (./semantics/flags.ts) and the project's remote config posthog-js loads at start,
// built from the project the World holds (./semantics/config.ts), and the posthog-js bundles PostHog serves from its
// static files (./semantics/static.ts). Surveys, the legacy decide route and recordings
// answer the gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'posthog', service: 'posthog', body: {}, ids: { template: '{uuid}' }, time: 'iso',
  // posthog-node gzips each batch and says so in Content-Encoding (@posthog/core sendBatch); the capture service reads
  // the header with the request (rust/capture/src/payload/common.rs), and its body is decoded before the handler reads it.
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/payload/common.rs "Extract payload bytes from request (handles query params, form data, base64 encoding)"
  encodings: { request: ['gzip'], undecodable: { status: 400, message: 'failed to decode request: invalid gzip data' } },
  // Capture uses the pinned Axum 0.7.9 default unknown-route response: empty 404.
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs "unregistered (404)"
  // source: https://raw.githubusercontent.com/tokio-rs/axum/axum-v0.7.9/axum/src/routing/not_found.rs "ready(Ok(StatusCode::NOT_FOUND.into_response()))"
  error: '',
  notFound: { status: 404, message: '' }, gap: { status: 404, message: '' },
  // source: https://posthog.com/docs/api/capture "api_key"
  // Project tokens belong to served capture payloads, not an HTTP auth gate on unknown routes.
  readOnly: { status: 403, message: 'This World is read-only.' },
  deleted: {},
  // posthog-js posts from the app's page, cross-origin (its remote config, flags and capture): PostHog's capture and
  // flags services both answer with a permissive CORS layer, the request's Origin echoed with credentials allowed, the
  // request's headers mirrored; the flags service adds HEAD and exposes its rate-limit warning, one lane answers both.
  // Where the kernel stops: it allows a declared header list, not a mirrored one; these are the headers posthog-js's
  // transport sends (Content-Type) and posthog-node's (Content-Encoding).
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs ".allow_origin(AllowOrigin::mirror_request())"
  // source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/feature-flags/src/router.rs ".allow_methods([Method::GET, Method::POST, Method::OPTIONS, Method::HEAD])"
  cors: {
    origin: 'echo',
    credentials: true,
    methods: 'GET, POST, OPTIONS, HEAD',
    headers: 'content-type, content-encoding',
    expose: 'x-posthog-rate-limit-warning',
  },
  resources: {},
  unmodeled: ["publicSurveys", "decide", "captureRecording"],
  vendorBacked: { none: 'Capture is telemetry ingestion, never deployed as account changes; the api manifest owns and refreshes the events and persons it makes.' },
  discovery: { twinOf: "PostHog's capture endpoints (/batch, /capture, /e, /i/v0/e) and its flags evaluation (/flags)", stores: 'events as the SDKs sent them and the persons their distinct ids make (the api lane reads them); flags are evaluated over the project, which holds none' },
};
