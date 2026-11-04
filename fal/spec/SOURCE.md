# Ideogram v2 Model API

`openapi.json`: fal's queue endpoint document, fetched 2026-09-30 unchanged from
https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ideogram/v2.
Version 1.0.0; no upstream Git commit is published for this HTTP-generated document.
SHA256: `1d7ca8c75f24fb06d561cf283596d88cfd607a4814418f2bb84875684e6ab4f5`.
Read 2026-10-01 against the demand scan's cached application commits.

`patches.json` corrects the submission response to IdeogramV2Output for the served synchronous
fal.run wire. The queue status/result/cancel paths remain unmodeled. Evidence:
https://fal.ai/docs/documentation/model-apis/overview.md and
https://fal.ai/docs/documentation/model-apis/inference/synchronous.md.

Other pages read for credentials and errors:
https://fal.ai/docs/api-reference/platform-apis/authentication.md,
https://fal.ai/docs/documentation/model-apis/errors.md.
The Platform API has its own unchanged document at `../platform/spec/openapi.json`.

The model page https://fal.ai/models/fal-ai/ideogram/v2/api was read 2026-10-01. Its full schema Input/Output and queue/storage SDK snippets are vendored as doc-examples.json; queue and storage wires are explicitly outside the served scope.
