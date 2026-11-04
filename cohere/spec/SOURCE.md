# Cohere API source

`openapi.yaml.gz` is Cohere's unmodified OpenAPI 3.1.0 document, API version `1.0`.
Upstream: [cohere-openapi.yaml](https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/35f6d97b834974daa7dde160f7ad942a8b0c2b12/cohere-openapi.yaml),
commit `35f6d97b834974daa7dde160f7ad942a8b0c2b12`. The upstream bytes fetched with
`twin-standard read-page --raw` match the decompressed vendored file exactly.

- Upstream/decompressed SHA-256: `814093aac6748d91ca9e6886970b11b34bf2edcf03c4eafac622f17c18e5c851`.
- Vendored gzip SHA-256: `e383421f4c42ca76f03cf976e7ae65dcb0bd2b7b579938a4ac64bf3af7703f22`.
- Corrections: none.
- Reader: Codex (GPT-6.1 Sol), 3 October 2026.

The spec's `x-fern-examples` are SDK request snippets. The repository's published-example
reader does not ingest that extension; their wire requests are captured with the matching
reference page in `doc-examples.json`. The reference, rerank overview, model catalogue and
errors pages supply the served operation's examples and stated rules. `sources.json`
records citation fetching and quote matching. No vendor API is called.
