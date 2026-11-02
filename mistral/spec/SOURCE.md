# Mistral API sources

- `openapi.yaml.gz`: Mistral's unmodified document from https://docs.mistral.ai/openapi.yaml, fetched
  2026-09-30. It is unversioned upstream; OpenAPI info.version is 1.0.0. Its gzip sha256 is
  `2ad44e318014c13dd3d0e13297fea3276808a2a908efaba72f1bb5ed725e7837`. No corrections. Read by Codex.
- `sources.json`: repository check-sources records for the API reference pages read with twin-standard read-page.
- The gap error envelope and status class are specified by https://docs.mistral.ai/resources/error-glossary.
  No unknown-request message body or absent-versus-null optional-field rule is established; no literal message
  or omission override is declared. The manifest uses hashed World credentials for the documented bearer wire; file-list examples describe operations outside scope.
- `doc-examples.json`: requests, rendered responses and stated rules from the chat, files, models and OCR API pages,
  kept as vendor-published records. The chat example is replayed with a World-issued key; examples of operations outside demanded chat remain gap-operation examples. The OCR Processor guide at
  https://docs.mistral.ai/capabilities/document_ai/basic_ocr supplies the accessible-URL precondition;
  OCR is outside the served scope.

The models response example is an array while ModelList and the models reference specify an object with data.
Upload/retrieve examples use bytes=null although their schemas require an integer. The published file list
shows batch output files whose creation needs an unserved batch job. These published records remain unchanged; no example brings an operation into scope or patches the vendor spec to agree with a twin. The raw spec's response examples remain unchanged.

The reference cURL file object is marked application/json, while the OpenAPI upload accepts only
multipart/form-data. Upload examples are counted as gap-operation examples; no upload handler creates local file state.

The rendered chat sample quotes created and leaves index as the string <to fill>. The vendor OpenAPI ChatCompletionResponse.created and ChatCompletionChoice.index require integers; the replay records these two reference differences and asserts the request-selected model.
