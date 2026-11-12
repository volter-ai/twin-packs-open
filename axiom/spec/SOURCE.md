# Axiom REST API v1

`openapi.json` is the unchanged Axiom Public API 1.0.0 document from
[axiomhq/docs](https://raw.githubusercontent.com/axiomhq/docs/44ace74b345f95629dae4a8ec9f1b9c558cfddc5/content/docs/(api-reference)/restapi/versions/v1.json),
commit `44ace74b345f95629dae4a8ec9f1b9c558cfddc5`. SHA256:
`05534454b1d198795e5be8383a9bcc048d1eaa921d808ec2997aab68d6115648`.
Read through twin-standard read-page; the fetched bytes match this file.

The legacy ingest wire is `/v1/datasets/{dataset_name}/ingest`. Current documentation
also describes `/v1/ingest/{dataset_name}` on an edge host; that separate deployment
is outside the configured applications' calls. `patches.json` corrects the error code
type from the document's own numeric examples.

Facts and examples are read from the legacy ingest and query references,
[limits](https://axiom.co/docs/reference/limits),
[tokens](https://axiom.co/docs/reference/tokens),
[datasets](https://axiom.co/docs/reference/datasets),
[API limits](https://axiom.co/docs/restapi/api-limits),
[API introduction](https://axiom.co/docs/restapi/introduction), and
[send data](https://axiom.co/docs/restapi/ingest). `doc-examples.json` retains their
examples and stated rules. The API introduction says failed authentication is 403;
the legacy ingest reference and vendored operation specify 401. Those operation-specific
status facts are retained without serving an authenticated operation. The seven edge-path
examples name an API absent from this legacy spec; they are recorded as outside its
operation inventory until a demanded caller brings that API into scope.

Reader: Codex contributor.
