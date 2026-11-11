// PostHog's capture service (rust/capture): one handler serves `/batch`, `/capture`, `/e` and `/i/v0/e`, each taking an
// event, a list of events or a batch `{api_key, batch, sent_at}`, plain, gzipped or base64 (posthog-node gzips its
// batches; posthog-js sends `compression=gzip-js`); the GET forms carry it in `data`. Each event is kept as it was
// sent, with its person effects, under the project its token names.
import type { HandlerContext } from '@volter/world-core';
import { apiManifest, capture } from './shared.ts';

// source: spec:captureBatch "Capture a batch of events"
export async function captureBatch(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
// source: spec:captureBatchGet "Legacy GET payload, plain JSON or base64"
export async function captureBatchGet(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs "/capture"
export async function captureEvent(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs "/i/v0/e"
export async function captureEvents(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
export async function captureEventsGet(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/rust/capture/src/router.rs "and a batch is accepted on any"
export async function captureEventsLegacy(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
export async function captureEventsLegacyGet(ctx: HandlerContext): Promise<Response> { return capture(ctx, apiManifest); }
