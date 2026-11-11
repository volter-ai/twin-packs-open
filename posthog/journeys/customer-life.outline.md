# PostHog customer life: outline

Author: Contributor 94

## The customer

**Harbourline** runs Rallly (lukevella/rallly at `3e63239dbdec`) with its optional PostHog analytics turned on, as the
World bench runs it (twin-world ADR 0036 §8; ../journeys/demand.json): the server's posthog-node 5.46.1 client
batches its captures (`track`, `trackSystemEvent`, the `$merge_dangerously` of a linked guest) and the account
erasure looks the person up and deletes it with its events (`deletePostHogPerson`). No SDK code is replaced. The
bench reads what was captured back through PostHog's own events and persons APIs with a personal API key.

The World clock starts 2026-01-01.

## People and programs

| who | holds | how |
|---|---|---|
| Harbourline | the project, its project token and a personal API key with person:write and query:read | bootstrap sign-up (the credential door) |
| Rallly's server | the project token | posthog-node 5.46.1, gzipped `/batch/` |
| Ada, first a guest | her guest id, then her account id | Rallly's pages |
| Rallly's pages in a visitor's browser | the project token | posthog-js 1.434.11, gzipped `/flags/` |
| The World bench | the personal API key, and posthog-node for its error evidence | the events and persons APIs; `/batch/` |

## The arc

### 1. Setting up (Mon 5 Jan, 09:00)
The bootstrap makes the project with its `phc_` project token and a `phx_` personal API key, the same at every boot.

### 2. A guest becomes Ada (Tue 6 Jan, 10:00)
Rallly's server flushes one gzipped batch whose `sent_at` is the flush time: the guest's `poll_comment_add`, personless
(`$process_person_profile: false`); Ada's `register` with her `$set` (name, email, tier, time zone, locale); the
`$merge_dangerously` that links the guest's id into her account; her `login`; her `space_setup` with a `$set` of her
name, time zone and job title. Capture answers `{status: Ok}`; each event is kept as sent, its time corrected by the
client's clock skew.

### 3. The bench exports the run (Wed 7 Jan, 09:00)
Ada's events, newest first, each with its properties as Rallly sent them; the guest's comment, still personless; the
register event with its person (identified, its first distinct id, email and name); the guest's id now naming Ada's
person with both distinct ids and her merged properties; the person by its UUID; one event by its uuid.

### 4. Ada deletes her account (Thu 8 Jan, 16:00)
Rallly's erasure looks her person up by her distinct id and deletes it with `delete_events` (202); Rallly records the
deletion personless under its system id. Her ids name no person; her events are still listed, queued for the weekly
deletion. On Sunday 11 January after 05:00 UTC her events and the guest comment merged into her are gone; the
system's personless record stays.

### 5. A visitor's browser and the bench's error evidence (Mon 12 Jan, 09:00)
Ben opens Rallly's landing page; its posthog-js 1.434.11 starts with the project token (`initPostHog`). It loads the
project's remote config script (`/array/<token>/config.js`): the project's settings as PostHog keeps them for it, at
their defaults (gzip and gzip-js, no flag, performance capture on, recordings, surveys and heatmaps off), in the
`window._POSTHOG_REMOTE_CONFIG` wrapper; the same config as JSON at `/array/<token>/config`, which a client without the
script loader reads; a token that names no project has none (404). The config says the project has no flag, so
posthog-js asks for flags only when Rallly's page reads one: a gzipped `POST /flags/?v=2` with Ben's anonymous id, his
initial person properties and time zone. The project holds no flag: `flags` is empty, nothing failed, a request id and
the evaluation time are given, and no configuration is added. Asked with `config=true`, the flags service passes the
project's remote config through, the same fields; a key that names no project is refused 401 `authentication_failed`,
and a token outside `[A-Za-z0-9_-]` 400 `Invalid token format`. At 09:05 the bench's server reports an error through
posthog-node's `captureException` with its own `$exception_fingerprint`; the flush is kept as sent, and the bench reads
the `$exception` back with its `$exception_list` and fingerprint unchanged.

## What the life does not do
posthog-js's other browser endpoints (surveys, recordings: Rallly starts posthog-js with
`disable_session_recording: true`, so it sends nothing to `/s/`), the legacy `/decide`, and every other API operation (`unmodeled`).
