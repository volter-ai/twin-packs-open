# Groq's API

- **Why this document:** Groq's own OpenAPI document, as its SDKs are generated from it (Stainless): the file
  groq/groq-python's `.stats.yml` names (`groqcloud-debd965b…`), fetched 2026-09-30 and vendored gzipped and unchanged.
  Server `https://api.groq.com`; chat completions at `/openai/v1/chat/completions`.
- **Corrections:** none.
- **Vendored bytes (sha256):** `openapi.yaml.gz` `2021716fe092bd3ebd1b4dacce565b1bd375c6753f0db4e0834a508ea953ab0a`.

- **Upstream URL:** https://storage.googleapis.com/stainless-sdk-openapi-specs/groqcloud/groqcloud-debd965baa031e12228c41e538741fa6055bf2813bcd062840a19f84a17cea95.yml
  The vendor SDK's `.stats.yml` names this document at commit
  `03056d63932b772457ffb2a8ba962e0987e3e984` of `groq/groq-python`.
- **Spec version:** GroqCloud API `2.1`.
- **Uncompressed upstream bytes (sha256):** `ea91f46f212ab4ed66f8278cbe43999c377a76217fa0c980d9cea9470c3ea8de`.
  Reading this immutable URL reproduces the vendored document byte for byte.
- **Read by:** Codex, 2026-10-03.
- **Scope:** No scanned application calls Groq. No operation, credential
  issuance or scenario is served; every operation answers the gap.
- **Refusal evidence:** https://console.groq.com/docs/errors documents
  the JSON error/message/type envelope with invalid_request_error and the
  404 not-found and 401 unauthorized classes. It does not fix distinct
  literal URL-refusal words, so the gap uses its documented class message.
  The spec's api_key security scheme declares HTTP Bearer authentication.
