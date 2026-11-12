# @volter/twin-posthog

PostHog's Protocol 3 twin, for Rallly's optional analytics as the World bench runs it ([journeys/demand.json](./journeys/demand.json)).
Capture and the private API share one vendor store.

| Wire | Behavior | Evidence |
|---|---|---|
| `us.i.posthog.com`, `eu.i.posthog.com`: `/batch/`, `/capture/`, `/e/`, `/i/v0/e/` (POST and GET) | An event, a list or a `{api_key, batch, sent_at}` batch, plain, gzipped (Content-Encoding or `compression=gzip-js`) or base64; token shape, event name and distinct id checked as the capture service checks them. Each event is kept in one write as sent (event, distinct_id, properties, timestamp, uuid), its time corrected for clock skew; `$identify`, `$create_alias` and `$merge_dangerously` merge persons by the ingestion rules, `$set`, `$set_once` and `$unset` change them, and a personless event makes no person. A token no project holds is accepted and its events dropped. | [ingest/spec](./ingest/spec/SOURCE.md) |
| `us.i.posthog.com`, `eu.i.posthog.com`: `/flags` (POST) | The project's feature flags for a distinct id, with the project token (`token` or `api_key`), JSON, base64 form or gzip: the project holds none, so `flags` is empty; `v>=2` answers the v2 shape (`flags`, `errorsWhileComputingFlags`, `requestId`, `evaluatedAt`), otherwise the v1 shape (`featureFlags`, `featureFlagPayloads`); `config=true` (or neither `v` nor `config`) adds the flags service's fallback configuration, recordings, surveys and heatmaps off. A missing or unknown token is 401, a missing distinct id 400. | [ingest/spec](./ingest/spec/SOURCE.md) |
| `us-assets.i.posthog.com`, `eu-assets.i.posthog.com`: `/static/<file>` (GET) | The posthog-js bundles PostHog serves from its static files (the files its `copy-posthog-js` copies, each with its map), byte for byte from the pack's `vendor/posthog-js/dist`, with WhiteNoise's headers; any other file is an empty 404. | [journeys/decisions.json](./journeys/decisions.json) (`staticAsset`) |
| `us.posthog.com`, `eu.posthog.com`: events list and retrieve, persons list, retrieve and delete | Read with a personal API key and its scopes; events newest first between `after` and `before` with the next page by timestamp; persons by distinct id, search or email; a person deleted at once, its events queued for PostHog's Sunday 05:00 UTC deletion and removed when it falls due. | [api/spec](./api/spec/SOURCE.md) |

World account door:

- `POST /_twin/app-credentials`: bootstrap sign-up: the project, its project token and a personal API key (person:write,
  query:read), the same at every boot; it fills `NEXT_PUBLIC_POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_API_HOST`,
  `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and `POSTHOG_API_HOST`.

Left out: posthog-js's other browser endpoints (decide, remote config, surveys, and session recordings at `/s/`: Rallly
starts posthog-js with `disable_session_recording: true`, and PostHog's documentation does not describe the recording
wire), autocaptured
elements, groups as stored entities, and every other API operation, which answer the gap.
