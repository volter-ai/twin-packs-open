# Tripo declared API — provenance

`openapi.json` is written from Tripo's own published SDK reference and client source. The pinned repository tree publishes no OpenAPI document; this pass never requests Tripo's API.

- Upstream: https://github.com/VAST-AI-Research/tripo-python-sdk
- Pin: `4115894a0a603c5183c9ed6dc8662745562c8941` (the `4115894` SDK reading).
- SDK version: `0.4.2`, as pyproject.toml declares; vendor API channels v2 and v3.
- Reader: Codex, 2026-10-03.
- Corrections: `patches.json` supplements the SDK-derived document with recording-backed HTTP 401 response schemas. The SDK bytes do not contain Authentication failed or establish a 401 response.

## Sources and retained bytes

Pages were fetched with `bun ../twin-world/packages/twin-standard/src/cli.ts read-page <url> --raw`. Gzip files retain those exact reference bytes; SHA-256 below hashes the decompressed upstream bytes.

- `sdk-client.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client.py; SHA-256 `cfbadb54a6460f4c0ef05493ebdd7c3a48d3087d1a59a0c7bc76cbf50f41d2bf`.
- `sdk-models.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/models.py; SHA-256 `ccb1379a3d0991cb5a45022670d37f5b204c80d4c0d40a1f9010de8632e680cc`.
- `sdk-aiohttp.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client_impl/aiohttp_client_impl.py; SHA-256 `c365485ce81ef2bacd9acb5ed493ba0d7de59101de0b756b0e8f82ceb10b0b66`.
- `sdk-legacy.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/tripo3d/client_impl/legacy_client_impl.py; SHA-256 `5044e4384ac9258053d2e408a6fe6871316cf146b088612d5d0470f714fbc551`.
- `sdk-project.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/pyproject.toml; SHA-256 `249884c9ffdd84ca349ac844d1c128c631368610b0cd3c685a9b5ebce7c2fd72`.
- `sdk-readme.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/README.md; SHA-256 `42e4dbb603c3b0db41e2636b028727422d7c65e47b5e0b8d3462c7adea4d2377`.
- `sdk-api.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/docs/API.md; SHA-256 `672b60e3e0bf4fd70f9287a636a6b6015bb559dc96a5217315580148b15128e5`.
- `example-image_to_model.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/image_to_model.py; SHA-256 `62905545a04b5bac6f0513c4270f097df8edeccf145e43c796748ec9f071c1d5`.
- `example-multiview_to_model.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/multiview_to_model.py; SHA-256 `d3d78f1710bd51f7dc5197caf76a50396c7d5b4148d93ad3be6b89c2d088529c`.
- `example-retarget_animation.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/retarget_animation.py; SHA-256 `e15c1cbbb316f04e86a289d11a2fd69bf3e5ffeb0dcdc6a045beee96bb06655c`.
- `example-rig_model.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/rig_model.py; SHA-256 `e5c0da8f46392d5f70d9f74576706e286828d265fa36247c8fca64b3260ec0b9`.
- `example-text_to_model.html.gz`: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/text_to_model.py; SHA-256 `42ae04207712ac4ca19742b0d836441330173faee4eda6f6fc54265c3533da4e`.
- `openapi.json` (written bytes): SHA-256 `d381cb788df4ab06978ba19deeb3e4c43ec2e7590603039a68401e69efb97d07`.

## Declared surface and translation boundaries

The document retains all eight fixed HTTP operations the pinned SDK declares: v2 balance, task creation/status, multipart upload and STS upload credentials; v3 file upload, task status and mesh segmentation. Task helpers (text/image/multiview model and image generation, import, conversion, stylization, texturing, refinement, riggability, rigging, retargeting, segmentation, completion and low-poly) all use task creation. Their pinned signatures and wire transformations are retained in `x-sdk-task-flows`, without treating SDK defaults as server defaults. `create_task` accepts an arbitrary dictionary: its request schema does not invent an exhaustive type restriction. SDK output dataclasses and from_dict reads supply the response fields. The SDK states no complete list of server validation rules or success statuses; the translation declares JSON 200 envelopes, not invented validation guarantees.

v2 paths carry /v2/openapi explicitly and use api.tripo3d.ai or api.tripo3d.com. v3 paths carry /v3 and use openapi.tripo3d.ai or openapi.tripo3d.com, recorded on their operation servers. These are one written SDK reference document; the pack serves only the demanded balance operation and does not dispatch any v3 handler. Returned model/download URLs and STS object-storage hosts are dynamic third-party URLs, not additional fixed Tripo operations. No such download flow is served.

README.md, docs/API.md and all five linked example programs supply the examples in `doc-examples.json`. Balance has no arguments or response numeric literals: replay checks the available/frozen fields for the account supplied by setup. Task and upload examples are retained and counted as unserved. The two retained unknown-request recordings are separate examples of the front refusal, replayed without creating an SDK operation. The API reference describes legacy upload as returning a string, while the pinned client now returns an object containing object or file_token; the spec follows the client's actual wire reads (image_token on legacy HTTP upload), and serves neither upload.

## Recorded authentication schemas

`recordings/bad-key.json` retains the 2026-09-30 bad-key reading from this repository’s original SOURCE.md: HTTP 401 and its exact code/message/suggestion JSON. The historical text retained neither the literal key nor the method/path; the recording states those limits. `patches.json` adds the 401 response under every declared operation: the envelope fields and sample values come from that recording, and v2 prefix authentication ordering from `recordings/unknown.json`. v3 bearer security is declared by the spec; the same recorded vendor error envelope is used for its refusal, without claiming a v3 wire observation. The unpatched document declares only SDK-derived success responses. Manifest error/auth rules cite the recordings directly.

## Existing wire recordings

`recordings/unknown.json` captures the protected-prefix request without Authorization on 2026-10-01: HTTP 401, code 1002, Authentication failed, with suggestion Check if your credentials is valid, and ensure you set it correctly. `recordings/gap.json` captures GET /unknown-path at the API front without Authorization: HTTP 404 text/html. Both are existing repository evidence, not calls made in this pass.

An authenticated unknown-prefix response and a v3 unknown-response body are not established by these sources. At that documentation boundary the gap uses the retained front's 404 bytes, after the proven v2 authentication gate or the declared v3 bearer gate, rather than inventing a task error code. No successful task/upload response is fabricated.
